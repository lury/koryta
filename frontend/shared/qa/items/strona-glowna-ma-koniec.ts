import type { QaItem } from "../../qa";

export const order = 100;

export default {
  id: "strona-glowna-ma-koniec",
  title: "Strona główna ma wreszcie koniec",
  description:
    "Lista „Ostatnie zatrudnienia” dociągała kolejne karty bez końca, więc " +
    "stopka - a w niej kontakt, źródła i linki do podstron - uciekała w dół " +
    "za każdym razem, gdy ktoś do niej scrollował, i nie dało się jej " +
    "dojść. Teraz feed dociąga sam dwie strony, a potem pokazuje przycisk " +
    "„Pokaż więcej”. Przy okazji przestaje pytać w kółko, kiedy " +
    "serwer odpowiada pustą stroną - to potrafiło się kręcić bez końca, po " +
    "kilkaset odczytów bazy na obrót.",
  steps: [
    "Wejdź na stronę główną i przewiń na sam dół.",
    "Feed dociągnie się dwa razy sam, a potem pojawi się przycisk „Pokaż więcej”.",
    "Przewiń niżej - widać stopkę.",
    "Kliknij przycisk: dochodzą kolejne karty, a przycisk wraca pod nimi.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
