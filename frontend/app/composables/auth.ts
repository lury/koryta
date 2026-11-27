import {
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type User,
} from "firebase/auth";
import { computedAsync } from "@vueuse/core";
import {
  useCurrentUser,
  useFirebaseAuth,
  useIsCurrentUserLoaded,
} from "vuefire";
import type { Ref } from "vue";
import type { NotificationPreferences } from "~~/shared/notifications";
import type { CampaignTopic, NewsletterUpdate } from "~~/shared/campaigns";
import {
  idTokenResultIfReachable,
  idTokenWhenOnline,
  ignoreNetworkFailure,
} from "~/utils/tokenRefresh";

/** Which campaign topics a reader asked for - see `shared/campaigns.ts`.
 * Absent means never asked, which is no. */
export type NewsletterPreferences = Partial<Record<CampaignTopic, boolean>>;

export type UserConfig = {
  photoURL?: string;
  displayName?: string;
  newsletter?: NewsletterPreferences;
  /** When and where `newsletter` last changed - see `NewsletterUpdate`; `at`
   * is ISO, as /api/me hands it out. */
  newsletterUpdated?: NewsletterUpdate<string>;
  /** Administrators only: campaigns sent to the team, which reach them
   * without a newsletter topic. Absent means yes. */
  teamMail?: boolean;
  /** Mail about what happened to this user's own contributions. Separate from
   * `newsletter`, which is broadcast to whoever asked for it: these default to
   * on and are read by the server before it queues anything. */
  notifications?: NotificationPreferences;
  /** Whether this person's name may be shown next to their work on
   * /eksploruj/statystyki. Absent means no - see `shared/profile.ts`, and note
   * that `/api/stats/activity` reads this same field with the admin SDK. */
  publicProfile?: boolean;
};

/** What PATCH /api/me takes (server/utils/meRules.ts). */
export type UserConfigPatch = Pick<
  UserConfig,
  "displayName" | "publicProfile" | "teamMail" | "notifications"
> & {
  newsletter?: NewsletterPreferences;
  newsletterVia?: Exclude<NewsletterUpdate["via"], "wypisz" | undefined>;
};

/** The reader's own `users/{uid}` through /api/me, shared by every caller on
 * the page: `data` is `undefined` until it is known for the account signed in
 * now, `null` for an account that never saved any. Read on a sign-in and
 * replaced by the answer to each save, since nobody else writes it (decision
 * on 2026-11-26: no Firestore listeners in the browser). */
function useUserConfig(user: Ref<User | null | undefined>) {
  const data = useState<(UserConfig & { id?: string }) | null | undefined>(
    "user-config",
    () => undefined,
  );
  const pending = useState<boolean>("user-config-pending", () => false);
  const loadedFor = useState<string | null>("user-config-for", () => null);

  async function refresh(force = false) {
    if (import.meta.server) return;
    const uid = user.value?.uid;
    if (!uid) {
      data.value = undefined;
      loadedFor.value = null;
      return;
    }
    if (!force && (loadedFor.value === uid || pending.value)) return;
    if (loadedFor.value !== uid) data.value = undefined;
    pending.value = true;
    try {
      const answer = await authRequest<{ config: UserConfig | null }>(
        "/api/me",
        { method: "GET" },
      );
      if (user.value?.uid !== uid) return;
      data.value = answer.config;
      loadedFor.value = uid;
    } catch (error) {
      console.error("Nie udało się wczytać ustawień konta", error);
    } finally {
      pending.value = false;
    }
  }

  async function save(patch: UserConfigPatch): Promise<UserConfig> {
    const answer = await authRequest<{ config: UserConfig }>("/api/me", {
      method: "PATCH",
      body: patch,
    });
    data.value = answer.config;
    loadedFor.value = user.value?.uid ?? null;
    return answer.config;
  }

  if (import.meta.client) {
    watch(
      () => user.value?.uid,
      () => void refresh(),
      { immediate: true },
    );
  }

  return { data, pending, refresh, save };
}

export function useAuthState() {
  const router = useRouter();
  const user = useCurrentUser();
  /** The claims on the reader's ID token, for the three flags below:
   * `undefined` while nobody is signed in, until the token has been read, and
   * while it needs a refresh there is no network for (`tokenRefresh.ts`).
   *
   * One read for all three. Each flag used to read the token itself, and a
   * page has many components that call this, so an expired token was sent to
   * be refreshed three times per component - and on a device woken with no
   * network, failed three times per component. */
  const claims = computedAsync(async () => {
    const current = user.value;
    if (!current) return undefined;
    return (await idTokenResultIfReachable(current))?.claims;
  });
  const isAdmin = computed(() => claims.value && !!claims.value.admin);
  /** The site's owner, whose task list (/admin/zadania) no other admin sees. */
  const isOwner = computed(() => claims.value && !!claims.value.owner);
  const isDatascience = computed(
    () => claims.value && !!claims.value.datascience,
  );
  /** A promise of the token, read only for whether there is one and never
   * awaited, so a failed refresh had nobody to handle it. Offline it no
   * longer reports itself; any other failure still does. */
  const idToken = computed(() => {
    const token = user.value?.getIdToken();
    token?.catch(ignoreNetworkFailure);
    return token;
  });
  const auth = useFirebaseAuth()!;

  const userConfig = useUserConfig(user);

  const logout = async () => {
    try {
      await signOut(auth);
      console.debug("User logged out successfully!");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const login = async (email: string, pass: string) => {
    return await signInWithEmailAndPassword(auth, email, pass);
  };

  const register = async (email: string, pass: string) => {
    return await createUserWithEmailAndPassword(auth, email, pass);
  };

  /** Sends the "set a new password" link to `email`.
   *
   * Firebase's email enumeration protection makes this succeed even for an
   * address with no account, so the caller must not report back whether the
   * address is known.
   */
  const resetPassword = async (email: string) => {
    return await sendPasswordResetEmail(auth, email);
  };

  return {
    user,
    isAdmin,
    isOwner,
    isDatascience,
    idToken,
    userConfig,
    logout,
    login,
    register,
    resetPassword,
  };
}

/** Resolves once firebase has restored (or ruled out) the signed in user. */
async function waitForAuthReady() {
  const isAuthReady = useIsCurrentUserLoaded();
  if (isAuthReady.value) return;

  await new Promise<void>((resolve) => {
    const unwatch = watch(
      isAuthReady,
      (ready) => {
        if (ready) {
          unwatch();
          resolve(); // Release the pause!
        }
      },
      { immediate: true },
    );
  });
}

/** One off authenticated request, for event handlers such as form submits.
 *
 * Use this instead of `authFetch` for anything that is not setup time data
 * loading: `authFetch` wraps `useFetch`, which registers async data keyed by
 * the url. A second call for the same key aborts the first one, and the
 * caller of the aborted request is left awaiting a promise that never
 * settles, so a submit button would spin forever even though the request
 * itself went through.
 *
 * A token that needs a refresh while the browser is offline holds the
 * request until it is back online (`idTokenWhenOnline`); the request could
 * not have gone out before that anyway. It waits no longer than `timeout`,
 * or `NETWORK_WAIT_MS` without one, and then fails with the token's error,
 * as it did at once before it waited.
 */
export async function authRequest<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    query?: unknown;
    /** Milliseconds to wait for an answer before failing. Without one, a
     * request whose answer never comes waits for as long as the connection
     * stays open - for a poll, which nobody is watching, that can be hours.
     * Offline it is also the longest the token waits for the network. */
    timeout?: number;
    /** The statuses a GET is sent again after, once, in place of ofetch's
     * own list. That list has 429 in it, and a request a limit turned down is
     * turned down again, the second try taken from the same limit. */
    retryStatusCodes?: number[];
  } = {},
): Promise<T> {
  await waitForAuthReady();

  const user = useCurrentUser();
  const headers = new Headers();
  if (user.value) {
    headers.set(
      "Authorization",
      `Bearer ${await idTokenWhenOnline(user.value, options.timeout)}`,
    );
  }

  // `string`, not the union of the routes Nitro knows: the caller names the
  // answer, and no route's type should be matched against it.
  return await $fetch<T, string>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
    headers,
    timeout: options.timeout,
    retryStatusCodes: options.retryStatusCodes,
  });
}

/** The `Authorization` header for `user`, or no headers when nobody is signed
 * in.
 *
 * For a plain `$fetch` made in answer to something the reader did on a page
 * that has long since settled - typing into a search box, opening a picker -
 * where `authRequest`'s wait for auth to resolve would only ever return at
 * once. Whatever asks for `latest` has to send one of these with it: the
 * server hands drafts only to a verified token, and a flag sent alone gets the
 * public answer.
 */
export async function authHeaders(
  user: User | null | undefined,
): Promise<Record<string, string>> {
  if (!user) return {};
  return { Authorization: `Bearer ${await idTokenWhenOnline(user)}` };
}

/** The counterpart to `authRequest`: a request sent deliberately without
 * credentials, even when somebody is signed in.
 *
 * The only caller is the feedback form, when the reporter has cleared their
 * address to send anonymously. Going through here rather than reaching for
 * `$fetch` at the call site is what makes that promise checkable in one place:
 * there is no token to attach, so the server cannot attribute the report even
 * if it wanted to.
 */
export async function anonymousRequest<T>(
  url: string,
  options: { method?: string; body?: unknown; query?: unknown } = {},
): Promise<T> {
  return await $fetch<T, string>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
  });
}

export const authFetch = createUseFetch({
  onRequest: async function ({ options }) {
    if (import.meta.server) {
      return;
    }

    const user = useCurrentUser();
    await waitForAuthReady();

    if (user.value) {
      // TODO don't auto add latest here
      options.query = { ...options.query, latest: true };

      // Every method, GET included. It used to be writes only, which left a
      // reading route with no way to tell a signed-in caller from a crawler
      // except the `latest` flag above - and a flag is the caller's to set, so
      // it can say "I am signed in" without being. `/api/extractions` is the
      // route that needs the difference: unreviewed machine claims about named
      // people are served to a reader and withheld from everyone else, and
      // with no token to verify it withheld them from everybody.
      //
      // Safe to widen because of who reads it. The handlers that ask for the
      // caller at all - `getOptionalUser`, `getUser` - are every one of them
      // uncached `defineEventHandler`s, so a signed-in answer cannot be filled
      // into a shared cache entry; `authCachedEventHandler` caches but never
      // looks at the header (`eventIsAuthenticated` is stubbed to false); and
      // `readerAwareCachedEventHandler` exists precisely to resolve the reader
      // before the cache is consulted. No route rule caches /api either.
      const token = await idTokenWhenOnline(user.value);
      const headers = new Headers(unref(options.headers) || {});
      headers.set("Authorization", `Bearer ${token}`);
      options.headers = headers;
    }
  },
});
