import type { QaItem } from "../../qa";

export const order = 265;

export default {
  id: "wykres-stanowisk-szybki-po-zalogowaniu",
  title: "Wykres na głównej szybki także po zalogowaniu",
  description:
    "Po zalogowaniu wykres „Zmiany na stanowiskach” ładuje się tak samo szybko jak bez logowania i pokazuje te same liczby.",
  steps: [
    "Zaloguj się i otwórz /?widok=stanowiska: wykres pojawia się tak szybko jak w oknie prywatnym.",
  ],
  link: "/?widok=stanowiska",
  area: "contributor",
} satisfies QaItem;
