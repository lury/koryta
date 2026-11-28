import type { QaItem } from "../../qa";

export const order = 194;

export default {
  id: "wyszukiwarka-drugi-czlon-nazwiska",
  title: "Wyszukiwarka znajduje nazwisko dwuczłonowe po drugim członie",
  description:
    "Wyszukiwarka dzieliła nazwę tylko na spacjach, więc „Wiśniowska” nie znajdowała Bogusławy Kupczak-Wiśniowskiej, a firmy „Wodno-Kanalizacyjnej” nie było pod „kanalizacyjne”. Teraz łącznik dzieli nazwę jak spacja: znajduje ją każdy człon osobno i oba wpisane ze spacją albo z łącznikiem.",
  steps: [
    "Wpisz w wyszukiwarkę w nagłówku strony „Kosiniak Kamysz”, ze spacją - podpowiedź pokazuje Władysława Kosiniaka-Kamysza.",
    "Gdy nazwy zostaną przeindeksowane po wdrożeniu, wpisz samo „Kamysz” - podpowiedź też go pokazuje.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
