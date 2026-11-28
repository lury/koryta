import type { QaItem } from "../../qa";

export const order = 9;

export default {
  id: "elections-column-narrower",
  title: "Węższa kolumna wyborów i przewijanie tabeli w bok",
  description:
    "Nazwa komitetu wyborczego i pełna nazwa okręgu przeniosły się z " +
    "plakietki do dymka, więc kolumna „Wybory” nie rozpycha już tabeli. " +
    "Kolumny, które i tak nie mieszczą się na ekranie, da się teraz " +
    "przewinąć w bok - wcześniej były po prostu ucięte.",
  steps: [
    "Wejdź na /eksploruj/tabela i znajdź osobę z wyborami - plakietka ma pokazywać rok i okręg, ucięty wielokropkiem, jeśli jest długi.",
    "Najedź na plakietkę - dymek ma podać pełną nazwę okręgu, województwo i komitet, jeśli jest znany.",
    "Na komputerze przewiń stronę w bok - kolumny od „Głosy łącznie” w prawo mają być dostępne.",
    "Przewiń stronę w dół - nagłówek tabeli ma nadal przyklejać się pod paskiem u góry.",
    "Przewiń w bok przy przyklejonym nagłówku - nagłówek ma jechać razem z kolumnami.",
    "Wejdź na inną stronę, np. /o-nas - poziomego paska przewijania ma tam nie być.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
