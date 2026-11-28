import type { QaItem } from "../../qa";

export const order = 37;

export default {
  id: "notatki-jak-reszta-sekcji",
  title: "Notatki wyglądają jak reszta strony",
  description:
    "Karta „Notatki” była wypukłym kaflem z paskiem tytułu, wstawionym " +
    "między „Historię powiązań” i „Zmiany na stanowisku”, które są zwykłymi " +
    "sekcjami na tle strony - i odstawała od nich tak, jakby pochodziła z " +
    "innego serwisu. Teraz ma taki sam nagłówek z ikoną i taki sam wstęp " +
    "jak one. Notatki na stronie spółki, artykułu, tematu i w panelu " +
    "bocznym tabeli rysuje ten sam komponent, więc zmieniły się wszędzie " +
    "naraz. Same notatki, przyciski i zapisywanie działają bez zmian.",
  steps: [
    "Wejdź zalogowany na stronę osoby, która ma notatki. Nagłówek „Notatki” ma być taki sam jak „Historia powiązań” nad nim - bez ramki kafla i bez cienia.",
    "Sprawdź, że wstęp „Wiesz więcej na temat tej osoby?” jest drobnym, szarym tekstem, tak jak podpis pod „Zmiany na stanowisku”.",
    "Dodaj źródło, zapisz, potem „Edytuj” i „Anuluj”. Wszystko ma działać jak wcześniej.",
    "To samo na stronie spółki, artykułu i tematu oraz w panelu bocznym otwieranym z /eksploruj/tabela.",
    "Wyloguj się i wejdź na stronę spółki z cudzą notatką - ma się pokazać z zachętą do zalogowania. Na stronie osoby notatek nadal nie ma dla niezalogowanych.",
  ],
  area: "public",
} satisfies QaItem;
