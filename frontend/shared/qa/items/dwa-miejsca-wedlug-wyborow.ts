import type { QaItem } from "../../qa";

export const order = 284;

export default {
  id: "dwa-miejsca-wedlug-wyborow",
  title: "„Dwa miejsca” także przy różnych urzędach w jednych wyborach",
  description:
    "Okno publikacji i znaczek „dwa miejsca” nie łączyły różnych urzędów, więc rada gminy obok sejmiku w innym województwie wyglądała na zwykłe wiersze, choć automat wstrzymuje za to stronę. Teraz liczą się wybory, jak w automacie.",
  steps: [
    "Na /admin/oswiadczenia rozwiń osobę wstrzymaną za „kandydatura w dwóch miejscach naraz”, otwórz „Strona osoby” i kliknij „Opublikuj”.",
    "Jej kandydatury z tych wyborów są w bloku nad listą, np. „Samorządowe 2024 - dwa miejsca naraz”, a „Zaznacz wszystkie” ich nie zaznacza. Zamknij okno bez publikacji.",
    "Na stronie osoby oba wiersze mają znaczek „dwa miejsca”.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
