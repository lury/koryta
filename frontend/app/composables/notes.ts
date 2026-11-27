import { computed, ref, toValue, type MaybeRef } from "vue";
import {
  mdiAlertCircleOutline,
  mdiDotsHorizontalCircleOutline,
  mdiLightbulbOnOutline,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiHelpCircleOutline,
  mdiVectorLink,
} from "@mdi/js";
import { authRequest, useAuthState } from "./auth";
import { useContributionsTick } from "./votes";
import type { Note, NoteEntryKind, NodeType } from "~~/shared/model";

/** How each note entry kind presents itself: the label on its chip, the button
 * that creates one, the tooltip under that button, the prompt above the text
 * area - and one written note of that kind, as an example.
 *
 * The example is not decoration. „Nie wiadomo trochę, jakie info tam wklejać”
 * is how an alpha tester put it, and a prompt phrased as a question does not
 * answer it: „Co ciekawego jest w tym źródle?” tells somebody they should type
 * something without telling them what a useful something looks like. One filled
 * in note does, in less space than a paragraph of instructions would.
 */
export const noteKindConfig: Record<
  NoteEntryKind,
  {
    title: string;
    addLabel: string;
    /** What this button does, for somebody deciding between it and the two
     * beside it. „Nie wiadomo co do tego służy i po co są dwa” was reported
     * about „Zgłoś poprawkę” standing under „Zaproponuj zmianę” in the side
     * panel - the two write to different queues, and nothing on screen said
     * so. */
    hint: string;
    prompt: string;
    /** A note of this kind, written out. Stored without the „np.” that a
     * placeholder wants in front of it, so the same sentence can also be listed
     * as an example above the form. */
    example: string;
    icon: string;
    color: string;
  }
> = {
  source: {
    title: "Źródło",
    addLabel: "Dodaj źródło",
    hint: "Link do artykułu albo dokumentu i jedno zdanie, co w nim jest.",
    prompt: "Co ciekawego jest w tym źródle?",
    example:
      "Artykuł z marca 2023: został prezesem dwa miesiące po wyborach, " +
      "wcześniej prowadził kampanię wójta. Link niżej.",
    icon: mdiLinkVariant,
    color: "primary",
  },
  change_request: {
    title: "Do poprawy",
    // „Zgłoś poprawkę”, as this read, was one verb away from „Zaproponuj
    // zmianę” in the same panel, and that button's label is what six e2e and
    // cypress specs click. So this one moved.
    addLabel: "Opisz błąd",
    hint:
      "Coś w danych jest nie tak - opisz to własnymi słowami, przeczyta to " +
      "redakcja. Samą metryczkę (imię, partia, data urodzenia, linki) " +
      "poprawisz od razu przez „Zaproponuj zmianę”.",
    prompt: "Co jest nie tak i jak powinno być?",
    example:
      "To imiennik - w radzie nadzorczej siedzi inny Jan Kowalski. Radny z " +
      "Radomia to osobna osoba.",
    icon: mdiPencilOutline,
    color: "warning",
  },
  missing: {
    title: "Brakuje danych",
    addLabel: "Zgłoś brak",
    hint: "Czegoś tu nie ma - napisz czego i skąd to wiadomo.",
    prompt: "Czego tu brakuje?",
    example:
      "Brakuje pracy w spółce wodociągowej 2019-2021, widać ją w KRS pod " +
      "numerem 0000123456.",
    icon: mdiHelpCircleOutline,
    color: "info",
  },
};

/** Entries written before kinds existed are all sources.
 *
 * Defined in `shared/model.ts` beside the kind itself and re-exported here,
 * which is where every component already reaches for it. */
export { noteKindOf } from "~~/shared/model";

/** What an admin decided the entry is about, once they have read it - the kind
 * above is what its author said it was. Stored as a plain string, so a value
 * that predates this list still reads back; the order here is the order the
 * buttons appear in on /admin/notatki/kategoryzacja.
 */
export const noteAdminTypeConfig: Record<
  string,
  { title: string; hint: string; icon: string; color: string }
> = {
  missing_data: {
    title: "Brakujące dane / Błąd",
    hint: "Coś jest nie tak albo czegoś brakuje w danych.",
    icon: mdiAlertCircleOutline,
    color: "error",
  },
  new_connection: {
    title: "Nowe powiązanie",
    hint: "Wskazuje osobę, spółkę lub relację, której jeszcze nie ma.",
    icon: mdiVectorLink,
    color: "primary",
  },
  context: {
    title: "Ciekawostka / Kontekst",
    hint: "Tło sprawy - nie zmienia danych, ale warto je mieć.",
    icon: mdiLightbulbOnOutline,
    color: "info",
  },
  other: {
    title: "Inne",
    hint: "Nie pasuje do żadnej z powyższych.",
    icon: mdiDotsHorizontalCircleOutline,
    color: "grey",
  },
};

/** The stored value read back for display. An empty type is "Brak"; one this
 * build does not know is shown as itself rather than swallowed. */
export function noteAdminTypeLabel(type: string | null | undefined): string {
  if (!type) return "Brak";
  return noteAdminTypeConfig[type]?.title ?? type;
}

/** The notes on one page, and the reader's own among them.
 *
 * `nodeType` where the caller knows it: the notes on a person are for signed
 * in readers (server/utils/noteRules.ts), so for anybody else this does not
 * ask - the answer would be empty anyway.
 */
export function useNotes(
  nodeID: MaybeRef<string>,
  nodeType?: MaybeRef<NodeType | undefined>,
) {
  const { user } = useAuthState();
  const tick = useContributionsTick();
  const nodeRef = computed(() => toValue(nodeID));

  /** The notes on the page, from GET /api/notes, read again after each save
   * (decision on 2026-11-26: no Firestore listeners in the browser). */
  const allNotes = ref<Note[]>([]);

  async function load() {
    const nodeId = nodeRef.value;
    if (!nodeId || (!user.value && toValue(nodeType) === "person")) {
      allNotes.value = [];
      return;
    }
    try {
      const { notes } = await authRequest<{ notes: Note[] }>("/api/notes", {
        method: "GET",
        query: { nodeId },
      });
      if (nodeRef.value === nodeId) allNotes.value = notes;
    } catch (error) {
      console.error("Nie udało się wczytać notatek", error);
    }
  }

  if (import.meta.client) {
    watch([nodeRef, () => user.value?.uid, () => toValue(nodeType)], load, {
      immediate: true,
    });
  }

  const userNote = computed(() => {
    if (!user.value) return null;
    return allNotes.value.find((n) => n.userUid === user.value?.uid) || null;
  });

  const otherNotes = computed(() => {
    if (!user.value) return allNotes.value;
    return allNotes.value.filter((n) => n.userUid !== user.value?.uid);
  });

  /** Stores the reader's note. The server stamps both dates, so a wrong
   * clock on one contributor's machine cannot pin their note to the top of
   * the admin queue. */
  const saveNote = async (data: Partial<Note>) => {
    if (!user.value) throw new Error("User must be logged in");
    const { note } = await authRequest<{ note: Note }>(
      `/api/notes/${encodeURIComponent(nodeRef.value)}`,
      { method: "PUT", body: { sources: data.sources ?? [] } },
    );
    allNotes.value = [
      ...allNotes.value.filter((n) => n.userUid !== user.value?.uid),
      note,
    ];
    tick.value += 1;
  };

  /** Points the note's entries at the article nodes their urls became.
   *
   * The server re-reads `sources` under a lock rather than being handed
   * them, because promoting is slow: it fetches every new url to read its
   * title, and an entry the author added while that was in flight would be
   * lost by writing back the array as it looked before. Entries are matched
   * by url, never by position. Writes nothing when nothing changed.
   */
  const attachArticleIds = async (articleIds: Map<string, string>) => {
    if (articleIds.size === 0 || !user.value) return;
    const { changed } = await authRequest<{ changed: boolean }>(
      `/api/notes/${encodeURIComponent(nodeRef.value)}/articles`,
      { method: "POST", body: { articleIds: Object.fromEntries(articleIds) } },
    );
    if (changed) await load();
  };

  return {
    userNote,
    // TODO enable users seeing other users nodes
    otherNotes,
    saveNote,
    attachArticleIds,
  };
}
