import { getAuth } from "firebase-admin/auth";

/** `getUsers` takes at most 100 identifiers per call. */
const AUTH_LOOKUP_CHUNK = 100;

/** `listUsers` hands out at most 1000 accounts per page. */
const LIST_USERS_PAGE = 1000;

/** How many pages `listNewAdmins` walks before it stops. Ten thousand accounts
 * is far past what the site has; the bound is there so a runaway sign-up wave
 * cannot turn one memo refresh into an unbounded walk of the auth service. */
const LIST_USERS_MAX_PAGES = 10;

/** Display data and roles for one account, from the auth service. Server side
 * only: which of these fields a caller may see is up to the endpoint's
 * per-caller presentation, never to this lookup. */
export type ContributorIdentity = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** Holds the `admin` claim right now. */
  admin: boolean;
  /** An administrator on trial. See `isNewAdmin`. */
  newAdmin: boolean;
};

/** Whether a set of custom claims marks an administrator on trial.
 *
 * Both claims, not `newAdmin` alone: ending a trial by demoting the account
 * leaves nothing to monitor, and a stray `newAdmin` on an account that is no
 * longer an administrator must not put it back on the list. */
export function isNewAdmin(
  claims: Record<string, unknown> | undefined,
): boolean {
  return claims?.admin === true && claims.newAdmin === true;
}

/** Whether an account is an established administrator right now: `admin`
 * without `newAdmin`, read from the account rather than from a token.
 *
 * A token keeps the claims it was issued with for up to an hour, and putting an
 * administrator on trial only adds `newAdmin` - nothing makes their browser
 * fetch a new token. Asked of the token alone, the one person a trial exists to
 * watch would keep the view that watches everybody else until it expired. An
 * account that no longer exists is nobody's administrator.
 */
export async function isEstablishedAdmin(uid: string): Promise<boolean> {
  let claims: Record<string, unknown> | undefined;
  try {
    claims = (await getAuth().getUser(uid)).customClaims;
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") {
      return false;
    }
    throw error;
  }
  return claims?.admin === true && claims.newAdmin !== true;
}

/** Display data for the given uids, so a page can say "Anna" instead of a
 * 28-character opaque string. Uids that no longer resolve are left out - the
 * work happened even if the account is gone, and the caller decides what to
 * print for it.
 *
 * The roles are read from the account itself rather than from anybody's token,
 * so a claim granted or revoked a minute ago is already in effect here. */
export async function identify(
  uids: string[],
): Promise<Record<string, ContributorIdentity>> {
  const found: Record<string, ContributorIdentity> = {};

  for (let i = 0; i < uids.length; i += AUTH_LOOKUP_CHUNK) {
    const chunk = uids.slice(i, i + AUTH_LOOKUP_CHUNK);
    const result = await getAuth().getUsers(chunk.map((uid) => ({ uid })));
    for (const user of result.users) {
      found[user.uid] = {
        displayName: user.displayName ?? null,
        email: user.email ?? null,
        photoURL: user.photoURL ?? null,
        admin: user.customClaims?.admin === true,
        newAdmin: isNewAdmin(user.customClaims),
      };
    }
  }

  return found;
}

/** Every administrator on trial right now, whether or not they did anything.
 *
 * The auth service cannot be queried by claim, so this walks the account list.
 * The claim lives there rather than in `users/{uid}` because that document is
 * writable by its owner - a flag in it would be one anybody could clear on
 * themselves.
 */
export async function listNewAdmins(): Promise<string[]> {
  const found: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < LIST_USERS_MAX_PAGES; page++) {
    const result = await getAuth().listUsers(LIST_USERS_PAGE, pageToken);
    for (const user of result.users) {
      if (isNewAdmin(user.customClaims)) found.push(user.uid);
    }
    pageToken = result.pageToken;
    if (!pageToken) return found;
  }

  console.warn(
    `listNewAdmins: stopped after ${LIST_USERS_MAX_PAGES} pages of ` +
      `${LIST_USERS_PAGE} accounts; administrators on trial past that are missing`,
  );
  return found;
}
