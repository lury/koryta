import { ref, toRef, toValue, watch, type MaybeRefOrGetter } from "vue";
import { refDebounced } from "@vueuse/core";
import { useCurrentUser } from "vuefire";
import { authHeaders } from "~/composables/auth";
import type { NodeType } from "~~/shared/model";
import type { NodeOption } from "~~/server/db/nodes";

/** A page whose name is close to one typed. */
export type NameMatch = { name: string; sourceURL?: string };

/** The pages of `type` the server finds for `name`, by id: /api/search for
 * people, places and regions, /api/search/pages (name or link) for articles
 * and topics. A page of them, not the whole type: the form that warns of a
 * duplicate listed every page of its type (`/api/nodes?type=`), which grows
 * with the base. Drafts for a signed in reader, who may have just made the
 * page they are about to make again. */
export function useNameMatches(
  type: MaybeRefOrGetter<NodeType>,
  name: MaybeRefOrGetter<string | undefined>,
) {
  const user = useCurrentUser();
  const typed = refDebounced(
    toRef(() => toValue(name)),
    300,
  );
  const entities = ref<Record<string, NameMatch>>({});
  let asked = 0;

  watch(
    [typed, () => toValue(type)],
    async ([term, kind]) => {
      const q = (term ?? "").trim();
      const mine = ++asked;
      if (q.length < 2) {
        entities.value = {};
        return;
      }
      const headers = await authHeaders(user.value);
      const latest = user.value ? { latest: true } : {};
      try {
        let found: [string, NameMatch][];
        if (kind === "article" || kind === "topic") {
          const options = await $fetch<NodeOption[]>("/api/search/pages", {
            query: { type: kind, q, ...(kind === "article" ? { url: q } : {}) },
            headers,
          });
          found = options.map((o) => [
            o.id,
            { name: o.name ?? "", sourceURL: o.url ?? "" },
          ]);
        } else {
          const hits = await $fetch<
            { id: string; name: string; type: string }[]
          >("/api/search", { query: { q, ...latest }, headers });
          found = hits
            .filter((hit) => hit.type === kind)
            .map((hit) => [hit.id, { name: hit.name }]);
        }
        if (mine === asked) entities.value = Object.fromEntries(found);
      } catch (e) {
        console.error("Name search failed", e);
        if (mine === asked) entities.value = {};
      }
    },
    { immediate: true },
  );

  return { entities };
}
