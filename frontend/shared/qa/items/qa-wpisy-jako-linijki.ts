import type { QaItem } from "../../qa";

export const order = 157;

export default {
  id: "qa-wpisy-jako-linijki",
  title: "Wpisy na tej liście to linijki, które rozwijają się po kliknięciu",
  description:
    "Każdy wpis był kartą z pełnym opisem, więc lista zajmowała wiele ekranów. Teraz to linijka z tytułem i Twoją oceną, a opis, kroki i przyciski oceny pokazują się po kliknięciu.",
  steps: [
    "Na /qa kliknij dowolny wpis - ma się rozwinąć z opisem, krokami, polem na uwagi i przyciskami „Działa” i „Coś nie działa”.",
  ],
  link: "/qa",
  area: "contributor",
} satisfies QaItem;
