import type { QaItem } from "../../qa";

export const order = 301;

export default {
  id: "eksploruj-nowe-osoba-w-adresie",
  title: "Kolejka pamięta w adresie, kogo pokazuje",
  description:
    "Adres /eksploruj/nowe ma identyfikator pokazanej osoby. „Następna osoba” dodaje wpis w historii przeglądarki, więc Wstecz wraca do poprzedniej osoby, a odświeżenie strony albo link otwierają tę samą.",
  steps: [
    "Zaloguj się i otwórz /eksploruj/nowe: w adresie pojawia się ?osoba= z identyfikatorem osoby z tabeli.",
    "Kliknij „Następna osoba”, a potem Wstecz w przeglądarce: wraca poprzednia osoba, w tabeli i na stronie pod nią.",
    "Odśwież stronę: zostaje ta sama osoba.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
