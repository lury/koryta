import type { QaItem } from "../../qa";

export const order = 18;

export default {
  id: "queue-plain-entry-links",
  title: "Nazwy wpisów w kolejce bez niebieskiego",
  description:
    "Kolejka zmian pokazuje nazwy wpisów tak samo jak profil - czarnym " +
    "tekstem, który podkreśla się dopiero pod kursorem, zamiast kolumny " +
    "niebieskich odnośników. Klikają tak samo jak wcześniej.",
  steps: [
    "Wejdź na /admin/rewizje/kolejka i spójrz na kolumnę z nazwami wpisów - mają być czarne, bez podkreślenia.",
    "Najedź kursorem na nazwę - ma się podkreślić.",
    "Kliknij ją - ma otworzyć stronę wpisu, tak jak dotąd.",
    "Porównaj z listą na /profil - obie mają wyglądać tak samo.",
    "Znajdź wiersz z powiązaniem albo z usuniętym wpisem - nazwa ma być zwykłym tekstem, bez odnośnika.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
