<template>
  <!-- One span, no wrapper. The <div> this used to be gave `text-overflow`
       below nothing to clip, so the 120px cap /eksploruj/tabela puts on the
       chip on a phone did nothing, and in card/PeopleList's `#append` the
       chips stacked one per line above the chevron rather than sitting beside
       it. Every other caller drops the chip into a flex row, where a block
       root and an inline one lay out the same. -->
  <!-- A space in front of the name, for whatever reads the page as text
       rather than looking at it - a search engine building a snippet, a
       screen reader, a copy and paste. Callers put the chip straight after a
       name, and Google's snippet read "Romuald BosakowskiPO". It is never
       drawn: a space at the start of the chip's own line collapses. -->
  <!-- `role="img"` with the full name as its label: a screen reader hears
       „Prawo i Sprawiedliwość”, not „P-i-S”, while the text stays the short
       form for search snippets and copy and paste. -->
  <span
    class="chip"
    :class="kind"
    :style
    :title
    role="img"
    :aria-label="label"
    >{{ ` ${partyShortName(party)}` }}</span
  >
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  OTHER_PARTY,
  partyChipPaint,
  partyFullName,
  partyShortName,
} from "~~/shared/misc";
import { ink } from "~~/shared/colors";

const {
  party,
  tie = undefined,
  note = undefined,
} = defineProps<{
  party: string;
  /** How the person is tied to the party, where it is not the plain way: a
   * backing PKW recorded is drawn as a frame with the party's colour down its
   * left edge (decision on 2026-11-17), and says so on hover (`note`). */
  tie?: "backing";
  /** What to say on hover in place of the default. */
  note?: string;
}>();

const kind = computed(() => (tie === "backing" ? "chip--backing" : undefined));

// The ink used to be a three-name map of the parties that get white text, with
// a near-black fallback, so Konfederacja's #102440 painted #090707 on navy at
// 1.29:1 and SLD's #D40E20 was one step behind it. `partyChipPaint` measures
// the fill instead, which a colour added to `partyColors` cannot get wrong -
// and it corrects PO too, whose white ink on #fca241 was 2.02:1.
//
// `backgroundColor` is left off entirely for a party `shared/misc` has no
// colour for, so that whatever surface the caller draws on shows through
// rather than being overridden with the string "undefined".
const style = computed(() => {
  const paint = partyChipPaint(party);
  if (tie !== "backing") return paint ?? { color: ink.strong };
  // The party's own colour as the frame and the stripe, the rest of the fill
  // left to the surface. „Inne”'s fill is too pale to draw a line in, so its
  // ink draws it.
  const line =
    party === OTHER_PARTY
      ? paint?.color
      : (paint?.backgroundColor ?? ink.strong);
  return { borderColor: line, color: ink.strong };
});

/** On hover, the note where the tie is not the plain one and the full name
 * otherwise. The legend over the table says the same in text. */
const title = computed(() => note ?? partyFullName(party));

/** What a screen reader hears: always the full name, then the note. */
const label = computed(() =>
  note ? `${partyFullName(party)}: ${note}` : partyFullName(party),
);
</script>

<style scoped>
.chip {
  /* Inline-block and not inline: an inline box ignores the width a caller caps
   * it at, which is what the ellipsis below needs to have anything to do. */
  display: inline-block;
  /* The chip is its own root now, so in a flex row it is the flex item - and a
   * flex item stretches to the cross axis unless told otherwise. Beside the
   * `text-h5` heading in EntityDetailsCard's `v-card-title` that made the chip
   * as tall as the person's name. It did not show while the root was a <div>
   * wrapping this span: the div stretched and the inline span inside it kept
   * its text height. Ignored outside a flex or grid parent, which is every
   * other caller. */
  align-self: center;
  padding: 0.1rem 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.3rem;
  font-weight: 550;
}

/* As tall as a filled chip: the frame takes its width out of the padding, and
   the stripe all but 2px of its own. */
.chip--backing {
  border: 1.5px solid;
  border-left-width: 6px;
  padding: calc(0.1rem - 1.5px) calc(0.4rem - 1.5px) calc(0.1rem - 1.5px)
    calc(0.4rem - 4px);
}
</style>
