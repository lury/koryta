import type { QaItem } from "../../qa";

export const order = 199;

export default {
  id: "szkice-tylko-dla-zalogowanych",
  title: "Szkice tylko dla zalogowanych, także pod ?latest=true",
  description:
    "Dopisanie „?latest=true” do zapytania pokazywało nieopublikowane osoby, ich kandydatury i partie każdemu, także niezalogowanemu. Teraz szkice dostaje tylko zalogowany czytelnik, a wyszukiwarka i tabela pokazują pozostałym wyłącznie opublikowane strony.",
  steps: [
    "Wyloguj się i wpisz w wyszukiwarkę nazwę spółki, której strona jest szkicem - podpowiedź jej nie pokazuje.",
    "Zaloguj się i wpisz ją jeszcze raz - podpowiedź ją pokazuje, a jej strona otwiera się jako szkic.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
