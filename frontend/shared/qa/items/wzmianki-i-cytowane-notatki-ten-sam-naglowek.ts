import type { QaItem } from "../../qa";

export const order = 92;

export default {
  id: "wzmianki-i-cytowane-notatki-ten-sam-naglowek",
  title:
    "„Artykuły, które o tym wspominają” i „Notatki z innych stron” mają nagłówek jak reszta sekcji",
  description:
    "Obie sekcje rysowały nagłówek własnym przepisem; teraz używają tego " +
    "samego szablonu co „Notatki” i „Zmiany na stanowisku”, więc ikona, " +
    "tytuł i podpis pod nim wyglądają wszędzie tak samo.",
  steps: [
    "Na stronie osoby ze wzmiankami w prasie i na stronie artykułu z notatkami z innych stron porównaj te nagłówki z nagłówkiem „Notatki” obok.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
