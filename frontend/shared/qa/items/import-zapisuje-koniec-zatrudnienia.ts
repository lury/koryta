import type { QaItem } from "../../qa";

export const order = 189;

export default {
  id: "import-zapisuje-koniec-zatrudnienia",
  title: "Import zapisuje koniec zatrudnienia",
  description:
    "Zatrudnienie zapisane, gdy ktoś jeszcze pełnił funkcję, zostawało na stronie jako bieżące, nawet gdy rejestr podawał już datę odejścia. Teraz import dopisuje tę datę do zapisanego zatrudnienia; datę wpisaną wcześniej i zatrudnienie usunięte zostawia bez zmian, ale zgłasza je w przebiegu.",
  steps: [
    "Na stronie Anny Ewy Konieczyńskiej kliknij „Wyślij dane tej osoby”, a gdy wysyłka się skończy, odśwież stronę - zarząd Karkonoskiej Agencji Rozwoju Regionalnego ma mieć koniec 25.08.2026.",
    "Na /admin/procesy przebieg importu osób ma licznik „niezapisanych zmian” - gdy nie jest zerem, podsumowanie przebiegu wymienia każdą z nich.",
  ],
  link: "/entity/person/sVbstV6fWxhYrZawvh7M",
  area: "admin",
} satisfies QaItem;
