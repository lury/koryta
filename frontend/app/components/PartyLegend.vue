<template>
  <!-- What the chips on the page stand for, in words: a chip is a colour and
       a short form, and neither is a name a reader can be assumed to know. -->
  <div v-if="shown.length" class="party-legend text-caption">
    <span class="party-legend__title">Partie:</span>
    <ul class="party-legend__list">
      <!-- The chip is hidden from a screen reader here: it would read the
           full name that follows it a second time. -->
      <li v-for="party in shown" :key="party" class="party-legend__entry">
        <span aria-hidden="true"><PartyChip :party /></span>
        <span>{{ partyFullName(party) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parties as knownParties, partyFullName } from "~~/shared/misc";

const { parties } = defineProps<{
  /** The parties to explain - the ones on the page, repeats allowed. */
  parties: string[];
}>();

/** In the order of `parties` in shared/misc - the graph legend's rank, „Inne”
 * last - and any name it does not know after those. */
const shown = computed(() => {
  const present = new Set(parties.filter(Boolean));
  const known = knownParties.filter((party) => present.has(party));
  const rest = [...present].filter((party) => !knownParties.includes(party));
  return [...known, ...rest.sort()];
});
</script>

<style scoped>
.party-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin: 0;
  color: rgb(var(--v-theme-ink-neutral));
}

.party-legend__title {
  font-weight: 500;
}

.party-legend__list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.party-legend__entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
