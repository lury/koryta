import type { QaItem } from "../../qa";

export const order = 65;

export default {
  id: "ingest-bez-pustych-rewizji",
  title: "Upload z pipeline'ów nie dopisuje rewizji, które nic nie zmieniają",
  description:
    "Pipeline'y wysyłają na stronę wszystkie firmy, które już na niej są, " +
    "i wszystkie osoby z regionu - raz za razem, bo nie wiedzą z góry, " +
    "o której z nich dowiedziały się czegoś nowego. Do tej pory każdy taki " +
    "upload dopisywał firmie rewizję, nawet jeśli była słowo w słowo taka " +
    "sama jak ta, którą firma już miała: historia zmian zapełniała się " +
    "powtórzeniami samej siebie, a strona przy okazji przepisywała się cała " +
    "od nowa. Teraz upload najpierw porównuje to, co ma zapisać, z tym, co " +
    "na stronie stoi, i jeśli nic by się nie zmieniło - nie pisze nic. " +
    "Zmiana, która coś wnosi, zapisuje się dokładnie tak jak wcześniej, " +
    "a firma, której brakuje licznika albo zatwierdzonej rewizji, dostaje " +
    "zapis mimo wszystko, bo tu zapis jest naprawą.",
  steps: [
    "Wejdź na /admin/rewizje/kolejka i zapamiętaj, ile rewizji czeka.",
    "Poproś o ponowny upload CompaniesPayloads (albo poczekaj na kolejny) i odśwież kolejkę - dla firm, o których nic nowego nie wiadomo, nie powinno przybyć nic.",
    "Otwórz dowolną firmę, która była w uploadzie, np. przez /instytucja/<slug>-<id>, i zjedź do historii rewizji: kolejne uploady nie mają dokładać wpisów z tą samą treścią.",
    "Sprawdź drugą stronę: zmień coś w danych firmy w pipeline (np. kategorię) i wyślij ponownie - ta jedna zmiana ma się zapisać normalnie.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
