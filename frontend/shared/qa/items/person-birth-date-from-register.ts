import type { QaItem } from "../../qa";

export const order = 140;

export default {
  id: "person-birth-date-from-register",
  title: "Daty urodzenia z rejestru trafiają na strony osób",
  description:
    "Rejestr podaje datę urodzenia właściwie każdej osoby z KRS-u, ale " +
    "formularz zgłoszeń jej nie przyjmował, więc na koryta.pl miały ją " +
    "tylko pojedyncze strony wpisane ręcznie. Teraz zapisuje się z " +
    "automatycznych zgłoszeń - raz, bo istniejącej daty nic nie nadpisuje.",
  steps: [
    "Wejdź na stronę dowolnej osoby z KRS-u i sprawdź, czy pod nazwiskiem jest data urodzenia.",
    "Wejdź w edycję osoby, wpisz w pole daty urodzenia coś niepoprawnego (np. „1967”) i zapisz - ma się pokazać błąd „Data urodzenia musi mieć postać RRRR-MM-DD”.",
  ],
  area: "public",
} satisfies QaItem;
