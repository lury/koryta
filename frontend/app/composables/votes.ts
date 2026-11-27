import {
  mdiAccountAlertOutline,
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiHelpCircleOutline,
  mdiLightbulbOutline,
} from "@mdi/js";
import { computed, reactive, type MaybeRef } from "vue";
import { useCurrentUser } from "vuefire";
import { authRequest, useAuthState } from "./auth";
import type { VoteCategory, VoteDocument } from "~~/shared/model";

/** The ink tokens rather than Vuetify's own `success`/`error`/`warning`:
 * `button/vote/Number.vue` writes these two names straight into `text-<name>`
 * on the count and into `:color` on the two arrows, and Vuetify's status
 * colours are picked as fills. On the white pill the count sits in, `success`
 * #4CAF50 measured 2.78:1 and `warning` #FB8C00 2.37:1 - both under the 3:1
 * an icon needs, let alone the 4.5:1 of the 12px number between them. That is
 * the „Twój głos” column of /eksploruj/tabela.
 *
 * `error` #B00020 passed on its own at 7.33:1 and was swapped anyway, so that
 * a category's up and down arrow are two steps of one ramp rather than one
 * measured colour beside one nobody here chose. `ink.danger` is 6.54:1.
 *
 * Nothing outside this file reads these two fields, so no filled control is
 * repainted by it. `shared/colors.ts` carries the measurements and
 * tests/composables/votes.test.ts holds them.
 */
export const voteCategoryConfig: Record<
  VoteCategory,
  {
    text: string;
    icon: string;
    color: string;
    downColor: string;
    /** What clicking the arrows actually asserts, in one sentence, in the first
     * person.
     *
     * The ladder below says how strong a verdict is; this says what the verdict
     * is *about*, and it is the half that was missing. An alpha tester working
     * through /eksploruj/nowe put it plainly: the scale reads perfectly well as
     * -5 to +5 and never says what makes a person „interesująca”, so the arrows
     * get clicked as a rating of the page - is this entry any good - rather
     * than as the judgement about the person that the queue is ordered by.
     *
     * Required on every category rather than only on the one that was
     * complained about, because a category whose meaning cannot be said in a
     * sentence is one nobody can vote on honestly. */
    meaning: string;
  }
> = {
  interesting: {
    text: "Dobre znalezisko",
    icon: mdiLightbulbOutline,
    color: "ink-success",
    downColor: "ink-danger",
    meaning:
      "W górę: moim zdaniem ta osoba powinna być oznaczona jako koryciarz - " +
      "ma posadę w spółce albo instytucji publicznej i polityczne powiązanie, " +
      "które ją tłumaczy. W dół: moim zdaniem nie powinna.",
  },
  quality: {
    text: "Znaleziony problem",
    icon: mdiAlertCircleOutline,
    color: "ink-danger",
    downColor: "ink-success",
    meaning:
      "W górę: coś się tu nie zgadza z danymi. W dół: sprawdziłem/am i jest w " +
      "porządku.",
  },
  correct: {
    text: "Poprawny fakt",
    icon: mdiCheckCircleOutline,
    color: "ink-success",
    downColor: "ink-danger",
    meaning:
      "W górę: ten fakt zgadza się ze źródłem. W dół: źródło mówi co innego.",
  },
  insufficient: {
    text: "Za mało informacji",
    icon: mdiHelpCircleOutline,
    color: "ink-warning",
    downColor: "ink-warning",
    meaning:
      "W górę: nie da się tego ocenić bez dodatkowych informacji, których tu " +
      "nie ma.",
  },
  wrongPerson: {
    text: "To nie ta osoba",
    icon: mdiAccountAlertOutline,
    color: "ink-warning",
    downColor: "ink-warning",
    meaning: "W górę: to imiennik - fakt dotyczy kogoś innego o tym nazwisku.",
  },
};

/** What a vote in this category asserts, for any surface that has to say so
 * before the reader has clicked anything. */
export function voteMeaning(category: VoteCategory): string {
  return voteCategoryConfig[category].meaning;
}

/** What each step of the -5..5 scale is meant to say.
 *
 * The number alone tells a voter nothing about where to stop, so every step
 * gets a phrase. Only categories that are actually voted on the wide scale
 * need an entry - the rest fall back to the category's own label. */
const scaleLabels: Partial<Record<VoteCategory, Record<number, string>>> = {
  interesting: {
    5: "Bezczelne",
    4: "Grube koryto",
    3: "Koryciarz",
    2: "Dobre znalezisko",
    1: "Ciekawe",
    [-1]: "Nie mogę znaleźć informacji",
    [-2]: "Wygląda w porządku",
    [-3]: "Nic tu nie ma",
    [-4]: "Pomyłka w danych",
    [-5]: "Nie powinno tu być",
  },
};

/** The phrase for one step of the scale, or undefined outside -5..5 and for
 * categories with no ladder of their own. */
export function voteLevelLabel(
  category: VoteCategory,
  value: number,
): string | undefined {
  return scaleLabels[category]?.[value];
}

/** The whole ladder as one sentence, for places that have to explain the scale
 * before the reader has clicked anything. */
export function voteScaleSummary(category: VoteCategory): string | undefined {
  const labels = scaleLabels[category];
  if (!labels) return undefined;
  const steps = [5, 4, 3, 2, 1, -1, -2, -3, -4, -5]
    .filter((value) => labels[value])
    .map((value) => `${value > 0 ? "+" : ""}${value} ${labels[value]}`);
  return `Skala od -5 do +5: ${steps.join(", ")}.`;
}

/** What each scoring model looks at, in the language of somebody reading the
 * site rather than of the pipeline that wrote the vote.
 *
 * Keyed by the `model_tag` each model in `data/pipelines/src/analysis/scores/`
 * declares, which is also the `userUid` its votes are stored under. The two
 * lists drift - a model can be added, renamed or retired without this file
 * knowing - so `scoreModelLabel` falls back to the uid rather than showing
 * nothing, and an unlabelled model reads as a slightly ugly name instead of
 * disappearing from a breakdown that claims to be complete. */
const scoreModelLabels: Record<string, string> = {
  pipeline: "Publiczni pracodawcy",
  "pipeline-pagerank": "Sieć powiązań",
  "pipeline-together": "Wspólne zarządy",
  "pipeline-turnover": "Posada po wyborach",
  "pipeline-succession": "Następca na stanowisku",
  "pipeline-capture": "Przejęta instytucja",
  "pipeline-facts": "Artykuły w bazie",
  "pipeline-locality": "Posada w miejscu kandydowania",
  "pipeline-publishable": "Szansa publikacji",
};

/** What a band of the publication chance stands for, by the cut-offs
 * `CHANCE_BANDS` in `data/pipelines/src/analysis/scores/publishable.py`. */
const publishChanceLabels: Record<number, string> = {
  5: "szansa od 90%",
  4: "szansa 75-90%",
  3: "szansa 50-75%",
  2: "szansa 15-50%",
  1: "szansa poniżej 15%",
};

export function publishChanceLabel(band: number): string | undefined {
  return publishChanceLabels[band];
}

/** A readable name for the model behind one pipeline vote. */
export function scoreModelLabel(uid: string): string {
  // `|| uid` rather than `?? uid`: stripping the prefix off a bare "pipeline"
  // leaves an empty string, not undefined, and an unnamed row is worse than an
  // ugly one.
  return scoreModelLabels[uid] || uid.replace(/^pipeline-?/, "") || uid;
}

/** A vote targets a graph node or an extraction fact; the target picks which
 * id field is set, so the id itself never needs inspecting. */
export type VoteTarget = "node" | "extraction";

type OwnVote = Pick<VoteDocument, "categoryVotes" | "comment" | "updatedAt">;

/** The reader's own votes, by `<kind>:<target>`, for everybody on the page:
 * `null` once asked for and absent. Browser only, and only ever this
 * reader's, so it is a module, not request state; a sign-in as somebody else
 * empties it. Votes are read from /api/votes/mine and written through
 * PUT /api/votes/:target (decision on 2026-11-26: no Firestore in the
 * browser). */
const ownVotes = reactive(new Map<string, OwnVote | null>());
let ownVotesUid: string | null = null;
const wanted = new Map<VoteTarget, Set<string>>();
let flush: Promise<void> | null = null;

const voteKey = (kind: VoteTarget, targetId: string) => `${kind}:${targetId}`;

function forUser(uid: string) {
  if (ownVotesUid === uid) return;
  ownVotes.clear();
  ownVotesUid = uid;
}

/** Asks for every target wanted in the same tick in one request per kind,
 * so a table of vote buttons is one read, not one per row. */
function requestOwnVote(kind: VoteTarget, targetId: string) {
  if (ownVotes.has(voteKey(kind, targetId))) return;
  let ids = wanted.get(kind);
  if (!ids) wanted.set(kind, (ids = new Set()));
  ids.add(targetId);
  flush ??= Promise.resolve().then(async () => {
    flush = null;
    const batches = [...wanted.entries()];
    wanted.clear();
    for (const [batchKind, targets] of batches) {
      const all = [...targets];
      for (let start = 0; start < all.length; start += 300) {
        const chunk = all.slice(start, start + 300);
        try {
          const { votes } = await authRequest<{
            votes: Record<string, OwnVote>;
          }>("/api/votes/mine", {
            method: "GET",
            query: { kind: batchKind, targets: chunk.join(",") },
          });
          for (const id of chunk) {
            ownVotes.set(voteKey(batchKind, id), votes[id] ?? null);
          }
        } catch (error) {
          console.error("Nie udało się wczytać głosów", error);
        }
      }
    }
  });
}

/** Bumped after every vote and note this reader saves, for the counters that
 * show their contributions (`useMyContributions`). */
export function useContributionsTick() {
  return useState("my-contributions-tick", () => 0);
}

async function putVote(
  targetId: string,
  target: VoteTarget,
  body: { categoryVotes?: Record<string, number>; comment?: string },
): Promise<OwnVote> {
  const { vote } = await authRequest<{ vote: VoteDocument }>(
    `/api/votes/${encodeURIComponent(targetId)}`,
    { method: "PUT", body: { kind: target, ...body } },
  );
  const own = {
    categoryVotes: vote.categoryVotes,
    comment: vote.comment,
    updatedAt: vote.updatedAt,
  };
  ownVotes.set(voteKey(target, targetId), own);
  return own;
}

export function useVotes(
  targetId: MaybeRef<string>,
  category: VoteCategory,
  target: VoteTarget = "node",
) {
  const { user } = useAuthState();
  const config = voteCategoryConfig[category];
  const tick = useContributionsTick();

  const idValue = computed(() => toValue(targetId));

  if (import.meta.client) {
    watch(
      [() => user.value?.uid, idValue],
      ([uid, id]) => {
        if (!uid || !id) return;
        forUser(uid);
        requestOwnVote(target, id);
      },
      { immediate: true },
    );
  }

  const userCategoryVotes = computed<Record<string, number>>(() => {
    if (!user.value) return {};
    return ownVotes.get(voteKey(target, idValue.value))?.categoryVotes ?? {};
  });

  const router = useRouter();
  const route = useRoute();
  const loading = ref(false);

  // Expose function to cast or toggle a vote
  const castVote = async (value: number) => {
    if (!user.value) {
      router.push({
        path: "/login",
        query: { redirect: route.fullPath },
      });
      return;
    }

    const currentVote = userCategoryVotes.value[category] ?? 0;
    const newValue = Math.max(-5, Math.min(5, currentVote + value));
    if (newValue === currentVote) return;

    // Shown at once and put back if the server turns it down, as Firestore's
    // local write showed it before.
    const key = voteKey(target, idValue.value);
    const before = ownVotes.get(key) ?? null;
    ownVotes.set(key, {
      ...(before ?? {}),
      categoryVotes: { ...(before?.categoryVotes ?? {}), [category]: newValue },
    });
    loading.value = true;
    try {
      await putVote(idValue.value, target, {
        categoryVotes: { [category]: newValue },
      });
      tick.value += 1;
    } catch (error) {
      ownVotes.set(key, before);
      console.error("Nie udało się zapisać głosu", error);
    } finally {
      loading.value = false;
    }
  };

  return {
    userCategoryVotes,
    config,
    loading,
    castVote,
  };
}

/** One vote written from an event handler, such as the review flow, where
 * the reactive state of `useVotes` is not needed. Returns false if there is
 * no signed-in user. */
export async function castVoteOnce(
  targetId: string,
  category: VoteCategory,
  value: number,
  target: VoteTarget = "node",
): Promise<boolean> {
  const user = useCurrentUser();
  if (!user.value) return false;
  forUser(user.value.uid);
  const clamped = Math.max(-5, Math.min(5, value));
  await putVote(targetId, target, { categoryVotes: { [category]: clamped } });
  useContributionsTick().value += 1;
  return true;
}

/** Attach a free-text comment to the caller's vote on a target.
 *
 * The same one-vote-per-(target, user) document as `castVoteOnce`, so a
 * comment written before any verdict still lands on it. Returns false if
 * there is no signed-in user. */
export async function saveCommentOnce(
  targetId: string,
  comment: string,
  target: VoteTarget = "node",
): Promise<boolean> {
  const user = useCurrentUser();
  if (!user.value) return false;
  forUser(user.value.uid);
  await putVote(targetId, target, { comment });
  return true;
}

/** Every vote of this reader's on targets of one kind, for a page that has
 * to know which of a long list they already judged (/ekstrakcje). */
export async function fetchOwnVotes(
  target: VoteTarget,
): Promise<Record<string, OwnVote>> {
  const { votes } = await authRequest<{ votes: Record<string, OwnVote> }>(
    "/api/votes/mine",
    { method: "GET", query: { kind: target } },
  );
  return votes;
}
