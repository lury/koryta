import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { refDebounced } from "@vueuse/core";
import type { Company } from "~~/shared/model";
import type { PlaceOption } from "~~/server/db/nodes";
import { authFetch } from "~/composables/auth";

/** The places an explore page with an employer filter knows of: those the
 * url selects (`place=`), whole, and a page of those matching what is typed
 * into the employer field (`placeSearch`, bound to the filter bar's
 * `company-search`), named by node id.
 *
 * The pages asked for every place instead (`/api/nodes?type=place`), which
 * at 640 thousand of them ran the server out of memory. Client only: the
 * pages render behind a <ClientOnly>, and a fetch during SSR would be
 * serialised into __NUXT_DATA__ for nothing. */
export function usePlaceOptions() {
  const route = useRoute();
  const placeParam = computed(() => {
    const raw = route.query.place;
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (value): value is string => !!value,
    );
    return values.length > 0 ? values : undefined;
  });
  const { data: selectedPlaces, execute: fetchSelectedPlaces } = authFetch<{
    nodes: Record<string, Company>;
  }>("/api/nodes", {
    query: computed(() => ({
      type: "place",
      ids: placeParam.value,
      limit: 50,
    })),
    server: false,
    immediate: false,
    watch: false,
  });
  watch(
    placeParam,
    (ids) => {
      if (ids && import.meta.client) void fetchSelectedPlaces();
    },
    { immediate: true },
  );
  const placeSearch = ref("");
  const typedPlace = refDebounced(placeSearch, 300);
  const { data: placeMatches } = authFetch<PlaceOption[]>(
    "/api/search/places",
    {
      query: computed(() => ({
        q: typedPlace.value || undefined,
        krs: route.query.krs ?? undefined,
      })),
      server: false,
    },
  );
  /** The options by name, the selected ones whole. */
  const places = computed<Record<string, Company>>(() => ({
    ...Object.fromEntries(
      (placeMatches.value ?? []).map((option) => [
        option.id,
        {
          name: option.name ?? "",
          krsNumber: option.krsNumber ?? undefined,
        } as Company,
      ]),
    ),
    ...(placeParam.value ? (selectedPlaces.value?.nodes ?? {}) : {}),
  }));
  return { places, placeSearch };
}
