import type { QaItem } from "../../qa";

export const order = 32;

export default {
  id: "przekierowanie-starego-adresu-nietrwale",
  title: "Stary adres wpisu nie zapamiętuje się w przeglądarce na stałe",
  description:
    "Adres z nieaktualną nazwą w linku (np. po zmianie nazwy spółki albo " +
    "po powrocie strony instytucji) nadal przenosi na właściwą stronę, ale " +
    "robi to przekierowaniem tymczasowym (302), a nie trwałym (301). " +
    "Trwałe przeglądarka zapisywała u siebie na zawsze i przestawała pytać " +
    "serwer - przez to strona instytucji po powrocie wciąż otwierała " +
    "Eksploruj u każdego, kto zajrzał tam wcześniej, i nie sięgało tam " +
    "żadne wdrożenie.",
  steps: [
    "Otwórz stronę spółki, np. /instytucja/pkp-szybka-kolej-miejska-w-trojmiescie-ZBcdQ9tUxVyv0o1mnpLH - ma się otworzyć strona instytucji, a nie /eksploruj/tabela.",
    "Podmień w adresie samą nazwę na byle jaką, zostawiając końcowe id (np. /instytucja/cokolwiek-ZBcdQ9tUxVyv0o1mnpLH) - ma przenieść na poprawny adres z właściwą nazwą.",
    "Wróć na ten sam zły adres jeszcze raz: ma znowu przenieść, a nie zostać na nim.",
    "To samo sprawdź na osobie (/osoba/zla-nazwa-<id>) i na temacie (/temat/zla-nazwa-<id>).",
    "Jeśli u siebie wciąż lądujesz na /eksploruj/tabela z adresu /instytucja/..., to stare trwałe przekierowanie zapisane w przeglądarce sprzed tej zmiany - sprawdź w oknie prywatnym albo po wyczyszczeniu pamięci podręcznej.",
  ],
  link: "/instytucja/pkp-szybka-kolej-miejska-w-trojmiescie-ZBcdQ9tUxVyv0o1mnpLH",
  area: "public",
} satisfies QaItem;
