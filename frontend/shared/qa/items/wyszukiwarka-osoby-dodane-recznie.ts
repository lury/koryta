import type { QaItem } from "../../qa";

export const order = 209;

export default {
  id: "wyszukiwarka-osoby-dodane-recznie",
  title: "Wyszukiwarka podpowiada niezalogowanym także osoby dodane ręcznie",
  description:
    "Niezalogowanym wyszukiwarka podpowiadała tylko te nieopublikowane osoby, które dodał import albo zatwierdziła redakcja, więc nie znajdowali nikogo dodanego ręcznie, także osób dodanych dlatego, że ktoś ich szukał. Teraz podpowiada każdą nieopublikowaną osobę, a jej strona prosi o zalogowanie.",
  steps: [
    "Wyloguj się i wpisz w wyszukiwarkę nazwisko osoby dodanej ręcznie, której strona czeka na zatwierdzenie (np. „Borys Budka”) - podpowiedź ją pokazuje, a jej strona prosi o zalogowanie.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
