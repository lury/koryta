import type { QaItem } from "../../qa";

export const order = 35;

export default {
  id: "wstecz-po-wejsciu-we-wpis",
  title: "Przycisk „wstecz” wraca tam, skąd się przyszło",
  description:
    "Kliknięcie wpisu w grafie, w historii powiązań albo w kolejce rewizji " +
    "prowadzi na jego stronę przez adres techniczny, który zaraz " +
    "przekierowuje na czytelny. To przekierowanie zjadało z historii " +
    "przeglądarki stronę, z której się przyszło - nie ten adres " +
    "techniczny, tylko poprzednią stronę - więc „wstecz” zostawało na " +
    "miejscu albo cofało o krok za daleko. Teraz historia ma dokładnie " +
    "jeden wpis na odwiedzoną stronę.",
  steps: [
    "Wejdź na stronę osoby, która ma graf (np. z /eksploruj/tabela).",
    "Kliknij dwa razy w spółkę na grafie - ma otworzyć się strona tej spółki pod czytelnym adresem /instytucja/....",
    "Naciśnij „wstecz”. Ma wrócić na stronę osoby, a nie zostać na stronie spółki.",
    "Naciśnij „dalej”. Ma znów pokazać stronę spółki - w historii jest jeden wpis, nie dwa, więc jedno kliknięcie wystarcza.",
    "To samo z odnośnikiem w „Historii powiązań” na stronie osoby i z nazwą wpisu w /admin/rewizje.",
    "Wejdź na /entity/person/<id> wpisując adres ręcznie. Ma przenieść na /osoba/... tak jak wcześniej.",
  ],
  area: "public",
} satisfies QaItem;
