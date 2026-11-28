import type { QaItem } from "../../qa";

export const order = 227;

export default {
  id: "urzad-kandydatury-nie-czeka-na-komitet",
  title: "Urząd i wynik kandydatury nie czekają na zatwierdzenie komitetu",
  description:
    "Gdy import nazywał urząd kandydatury zapisanej jako „Samorząd”, a w tym samym wierszu przychodził komitet spoza naszej listy (zwykle lokalny KWW), cała zmiana czekała na zatwierdzenie i strona dalej pokazywała „Samorząd”. Teraz urząd i wynik z danych PKW zapisują się od razu, także w kandydaturze zapisanej bez urzędu, jeśli w tym roku były tylko jedne wybory, a do zatwierdzenia w /admin/rewizje zostaje sam komitet.",
  steps: [
    "Na stronie Roberta Marka Starzyńskiego kliknij „Wyślij dane” i poczekaj, aż przebieg się skończy - kandydatury mają mówić „Wójt”, „Rada gminy” i „Rada powiatu” zamiast „Samorząd”, a w /admin/rewizje#powiazania jego propozycje mają dodawać już tylko komitet.",
  ],
  link: "/osoba/robert-marek-starzynski-u2pkEx0hJEiW9W5EGjSA",
  area: "admin",
} satisfies QaItem;
