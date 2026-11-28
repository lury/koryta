import type { QaItem } from "../../qa";

export const order = 250;

export default {
  id: "automat-w-aktywnosci-i-statystykach",
  title: "Publikacje automatu widać na /aktywnosc i w statystykach",
  description:
    "Osób, które automat opublikował sam, nie było nigdzie w aktywności. Teraz /aktywnosc ma ich wiersz „Automat” z dopiskiem „oświadczenia majątkowe” i chip „Automat”, a „Opublikowane osoby” w statystykach i liczba z ostatnich 30 dni liczą je razem z publikacjami ludzi, poza rankingiem.",
  steps: [
    "Na /aktywnosc znajdź wiersz „Automat” z dopiskiem „oświadczenia majątkowe”, „opublikował N osób”. Chip „Automat” zostawia tylko te wiersze, a nad listą jest „… zmian od M osób i automatu”.",
    "Na /eksploruj/statystyki pod „Opublikowane osoby” jest „w tym N automatycznie”, a w rankingu nie ma automatu.",
  ],
  link: "/aktywnosc",
  area: "contributor",
} satisfies QaItem;
