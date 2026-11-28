import type { QaItem } from "../../qa";

export const order = 86;

export default {
  id: "fakt-na-powiazanie",
  title: "Wydobyty fakt można zamienić na powiązanie w grafie",
  description:
    "Do tej pory fakt wydobyty z artykułu można było tylko ocenić - i na " +
    "tym się kończyło: nic nie czytało tej oceny, a żeby zapisać to, co fakt " +
    "mówi, trzeba było przepisać go ręcznie w formularzu na stronie osoby. " +
    'Karta faktu ma teraz przycisk "Utwórz powiązanie". Osobę bierzemy z ' +
    "dopasowania zrobionego przy imporcie, drugą stronę wskazujesz sam - " +
    "nazwa firmy w artykule to zwykły tekst, a dwie firmy noszą tę samą " +
    "nazwę równie często jak dwie osoby. Powiązanie powstaje jako szkic i " +
    "ma artykuł jako źródło. Dotyczy zatrudnienia i relacji osobistych; " +
    "członkostwo partyjne i rola w aferze nie mają jeszcze typu powiązania " +
    "i przycisku nie dostają.",
  steps: [
    "Zaloguj się i wejdź na stronę artykułu, z którego coś wydobyto.",
    'Rozwiń "Wydobyte fakty".',
    'Na fakcie o zatrudnieniu kliknij "Utwórz powiązanie".',
    "Wskaż pracodawcę, sprawdź stanowisko i zapisz.",
    "Kliknij drugi raz to samo - powinno trafić w to samo powiązanie, a nie utworzyć drugie.",
    "Wejdź na stronę tej osoby i sprawdź, że powiązanie tam jest, oznaczone jako szkic.",
  ],
  area: "contributor",
} satisfies QaItem;
