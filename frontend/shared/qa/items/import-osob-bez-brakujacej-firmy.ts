import type { QaItem } from "../../qa";

export const order = 204;

export default {
  id: "import-osob-bez-brakujacej-firmy",
  title: "Import zapisuje osobę, nawet gdy jednej z jej firm nie ma na stronie",
  description:
    "Gdy osoba pracowała w spółce, której serwis nie ma, import odrzucał całą osobę i zapisywał ją dopiero po dodaniu tej spółki - a gdy spółki nie dało się dodać, nie trafiało na stronę nic: ani osoba, ani jej pozostałe zatrudnienia i kandydatury. Teraz zapisuje wszystko, co ma gdzie umieścić, pomija tylko zatrudnienia w brakujących spółkach, dodaje te spółki i wysyła osobę jeszcze raz.",
  steps: [
    "Rano po nocy otwórz /admin/procesy i rozwiń „Import osób na stronę” - ostatnie uruchomienie ma licznik „zatrudnień bez strony firmy”, zwykle 0, obok „dodanych firm”.",
    "Gdy „zatrudnień bez strony firmy” nie jest zerem, uruchomienie jest częściowe, a jego błędy wymieniają firmę, której nie udało się dodać - strona osoby z tego uruchomienia ma pozostałe zatrudnienia.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
