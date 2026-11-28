import type { QaItem } from "../../qa";

export const order = 73;

export default {
  id: "kolejka-mowi-co-oznacza-glos",
  title: "Kolejka mówi wprost, co znaczy głos i co pisać w notatce",
  description:
    "Osoba testująca przeszła przez /eksploruj/nowe i nie wiedziała, co " +
    "właściwie znaczy, że ktoś jest „interesujący” - skala od -5 do +5 " +
    "czytała się jak ocena wpisu, a nie jak zdanie o człowieku. Nie było " +
    "też wiadomo, jakie informacje wklejać w notatki. Nad kolejką stoi " +
    "teraz zdanie o tym, na czym polega zadanie, głos jest opisany wprost " +
    "(„w górę: moim zdaniem koryciarz”) w krokach, w dymku i w nagłówku " +
    "kolumny, a nad notatkami są trzy przykłady, jak taka notatka wygląda.",
  steps: [
    "Wejdź na /eksploruj/nowe. Nad paskiem postępu ma stać akapit mówiący, co robisz i co znaczy głos w górę i w dół.",
    "Rozwiń „Jak to działa?”: krok „Głos” ma opisywać znaczenie głosu, a pod krokami ma być wypisana cała skala od -5 do +5.",
    "Najedź na liczbę w kontrolce głosu - dymek ma mówić, co głos oznacza, zanim powie, jak daleko sięga skala.",
    "Zjedź do sekcji „Notatki” i sprawdź, że nad polami są trzy przykłady (źródło, do poprawy, brakuje danych).",
    "Kliknij „Dodaj źródło” - w polu tekstowym ma być widoczny przykładowy wpis jako podpowiedź.",
    "Na /eksploruj/tabela najedź na nagłówek „Twój głos” - ma mówić to samo, co kolejka.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
