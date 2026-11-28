import type { QaItem } from "../../qa";

export const order = 193;

export default {
  id: "nazwisko-dwuczlonowe-z-lacznikiem",
  title: "Nazwisko dwuczłonowe z łącznikiem, jak w PKW i na Wikipedii",
  description:
    "Rejestr zapisuje nazwisko dwuczłonowe ze spacją („Kupczak Wiśniowska”), PKW i Wikipedia z łącznikiem. Strona osoby bierze teraz łącznik z jej rekordu PKW albo artykułu - także strona założona wcześniej, po najbliższym imporcie.",
  steps: [
    "Po najbliższym nocnym imporcie otwórz stronę Bogusławy Kupczak-Wiśniowskiej - w nagłówku nazwisko ma łącznik, nie spację.",
  ],
  link: "/entity/person/A7NEVnjbRJEf0hdLlAOL",
  area: "public",
} satisfies QaItem;
