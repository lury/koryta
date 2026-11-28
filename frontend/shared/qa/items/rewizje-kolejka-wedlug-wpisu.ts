import type { QaItem } from "../../qa";

export const order = 180;

export default {
  id: "rewizje-kolejka-wedlug-wpisu",
  title: "Kolejka zmian: opublikowane strony i jeden wiersz na wpis",
  description:
    "W „Czeka na decyzję” na /admin/rewizje jest filtr „Strona” - opublikowane albo nieopublikowane - i przełącznik „Lista / Według wpisu”, który składa propozycje w jeden wiersz na wpis. Zmiana powiązania trafia do osoby, której dotyczy, więc „Z pipeline'u”, „Opublikowane” i „Według wpisu” razem dają opublikowane osoby ze zmianami, które jeszcze nie weszły.",
  steps: [
    "Ustaw „Rodzaj: Z pipeline'u” i „Strona: Opublikowane”, a potem kliknij „Według wpisu” - mają zostać same opublikowane wpisy, każdy z liczbą propozycji, a nad listą zdanie, ile propozycji jest w ilu wpisach.",
    "Rozwiń jeden wpis i zatwierdź albo odrzuć propozycję w środku - ma zniknąć z grupy, a liczba w wierszu ma spaść o jeden.",
  ],
  link: "/admin/rewizje?automatic=true&published=true&group=subject#kolejka",
  area: "admin",
} satisfies QaItem;
