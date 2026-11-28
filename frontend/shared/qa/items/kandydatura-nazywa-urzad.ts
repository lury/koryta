import type { QaItem } from "../../qa";

export const order = 196;

export default {
  id: "kandydatura-nazywa-urzad",
  title: "Kandydatura samorządowa mówi, o jaki urząd chodziło",
  description:
    "Kto w jednym roku startował do rady miasta i na prezydenta, miał dwie jednakowe kandydatury „Samorząd”, które wyglądały na duplikat - a gdy wygrał obie, jedna znikała. Teraz kandydatura nazywa urząd z danych PKW: radę miasta, gminy, powiatu lub dzielnicy, sejmik, wójta, burmistrza albo prezydenta.",
  steps: [
    "Gdy dane PKW zostaną przebudowane, po najbliższym imporcie otwórz stronę Marcina Witki - w 2010 są „Rada miasta” (wybrany) i „Prezydent”, a w 2018 i 2024 po dwie kandydatury zamiast jednej.",
  ],
  link: "/entity/person/B0VyVTOmLjlmC0Npq3ev",
  area: "contributor",
} satisfies QaItem;
