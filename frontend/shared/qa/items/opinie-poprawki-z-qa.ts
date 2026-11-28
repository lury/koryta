import type { QaItem } from "../../qa";

export const order = 152;

export default {
  id: "opinie-poprawki-z-qa",
  title: "Wpis na tej liście może wskazać zgłoszenie, które poprawia",
  description:
    "Takie zgłoszenie ma na /admin/opinie chip „Poprawka”: szary, dopóki nikt nie sprawdził wpisu, zielony, gdy działa, " +
    "czerwony, gdy ktoś zgłosił problem. Link do wpisu otwiera teraz /qa na tym wpisie, nawet jeśli już go oceniłeś.",
  steps: [
    "Na /admin/opinie kliknij chip „QA: …” przy zgłoszeniu napisanym z tej listy - /qa ma się otworzyć na tym wpisie.",
    "Chip „Poprawka” pojawi się przy pierwszym zgłoszeniu, które wskaże któryś następny wpis. Wtedy kliknij go - ma pokazać wpis, oceny sprawdzających i zgłoszenia napisane po poprawce. Gdy chip jest zielony, a żadne z tych zgłoszeń nie jest otwartym „Coś nie działa”, karta ma przycisk „Zamknij jako załatwione”.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
