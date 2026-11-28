import type { QaItem } from "../../qa";

export const order = 205;

export default {
  id: "noc-dodaje-firmy-przed-osobami",
  title: "Noc dodaje brakujące firmy, zanim wyśle osoby",
  description:
    "Przed importem osób noc dodaje firmy, w których pracują wysyłane osoby, a których nie ma w porannej kopii bazy. Dotąd import dodawał każdą z nich dopiero po drodze, gdy strona przyjęła osobę bez tego zatrudnienia - 16 firm w nocy z 14 października.",
  steps: [
    "Rano po nocy otwórz /admin/procesy i rozwiń „Import firm” - ostatnie uruchomienie jest z nocy, z licznikami „w paczce” i „dodanych firm”.",
    "Rozwiń „Import osób na stronę” - w uruchomieniu z tej samej nocy „dodanych firm” i „zatrudnień bez strony firmy” mają być zwykle 0.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
