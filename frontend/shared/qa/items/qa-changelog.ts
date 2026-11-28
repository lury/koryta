import type { QaItem } from "../../qa";

export const order = 7;

export default {
  id: "qa-changelog",
  title: "Lista zmian do sprawdzenia",
  description:
    "Ta strona. Każda nowa zmiana na stronie dostaje tu wpis z instrukcją, " +
    "co kliknąć, żeby ją zobaczyć. Zalogowany użytkownik oznacza, czy " +
    "działa, i zostawia uwagi.",
  steps: [
    "Otwórz QA z paska na górze - licznik pokazuje, ilu zmian Ty jeszcze nie sprawdziłeś.",
    "Rozwiń wpis i sprawdź, że kroki opisują to, co faktycznie widać.",
    "Kliknij „Działa” albo „Coś nie działa” i dopisz uwagę.",
    "Odśwież stronę - Twój wybór i uwaga mają się utrzymać.",
    "Przełącz filtr na „Wszystkie” - sprawdzony wpis ma zniknąć z listy „Do sprawdzenia”.",
    "Zaloguj się na drugie konto - ten sam wpis ma tam nadal czekać na sprawdzenie.",
  ],
  link: "/qa",
  area: "contributor",
} satisfies QaItem;
