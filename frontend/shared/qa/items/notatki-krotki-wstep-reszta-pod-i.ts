import type { QaItem } from "../../qa";

export const order = 116;

export default {
  id: "notatki-krotki-wstep-reszta-pod-i",
  title: "Krótszy wstęp w „Notatkach”, reszta pod ikoną (i)",
  description:
    "Nad notatkami zostało jedno pytanie zamiast pięciu linijek prozy - " +
    "cała instrukcja razem z trzema przykładami notatek jest teraz w " +
    "dymku pod ikoną (i) przy nagłówku sekcji. Ten sam mechanizm " +
    "dostała sekcja „Notatki z innych stron” na stronie artykułu, gdzie " +
    "dwa akapity wstępu stały jeden nad drugim.",
  steps: [
    "Zaloguj się i otwórz /eksploruj/tabela, a potem kliknij nazwisko, żeby otworzyć panel boczny (albo wejdź na stronę dowolnej osoby).",
    "W sekcji „Notatki” sprawdź, że pod nagłówkiem została jedna linijka: „Wiesz więcej na temat tej osoby?” - bez akapitu i bez listy przykładów.",
    "Kliknij ikonę (i) obok nagłówka „Notatki”: w dymku ma się pokazać reszta wyjaśnienia i trzy przykładowe notatki. Sprawdź też, że ikona daje się złapać tabulatorem.",
    "Otwórz stronę artykułu, przy którym są notatki z innych stron - sekcja „Notatki z innych stron” nie ma już akapitu wstępu, jego zdanie jest pod (i).",
    "Dodaj własną notatkę i zapisz ją: wstęp razem z ikoną (i) znika, bo instrukcja nie jest już potrzebna.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
} satisfies QaItem;
