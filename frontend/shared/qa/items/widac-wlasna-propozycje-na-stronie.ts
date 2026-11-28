import type { QaItem } from "../../qa";

export const order = 76;

export default {
  id: "widac-wlasna-propozycje-na-stronie",
  title: "Strona instytucji pokazuje, co się na niej zaproponowało",
  description:
    "Po wysłaniu „Zaproponuj zmianę” strona wracała do wersji sprzed " +
    "zmiany i nie mówiła nic więcej - potwierdzenie znikało przy " +
    "odświeżeniu, a jedyne miejsce z odpowiedzią było na /profil. Jedna " +
    "osoba wysłała przez to tę samą poprawkę do spółki kilka razy. Teraz " +
    "pod nagłówkiem instytucji stoi karta „Twoje propozycje zmian do tej " +
    "strony”: status każdej z nich, co dokładnie zmienia, podgląd strony w " +
    "tej wersji i powód odrzucenia, jeśli redakcja odmówiła. Serwer " +
    "dokłada się z drugiej strony - to samo zgłoszenie wysłane dwa razy " +
    "trafia w tę samą propozycję zamiast zakładać kolejną, a propozycja, " +
    "która niczego nie zmienia, nie przechodzi w ogóle. Admin ma tam też " +
    "skrót „Rewizje” do historii zmian spółki, którego strona instytucji " +
    "- w odróżnieniu od strony osoby - nigdy nie miała.",
  steps: [
    "Zaloguj się i wejdź na stronę dowolnej instytucji. Dopóki nic tu nie zgłosiłeś, żadnej karty z propozycjami nie ma.",
    "Kliknij „Zaproponuj zmianę”, zmień opis i wyślij. Pod nagłówkiem ma się pojawić karta „Twoje propozycje zmian do tej strony” ze statusem „Oczekuje”.",
    "Odśwież stronę - karta ma tam nadal być, razem z podpisem mówiącym, ile propozycji czeka na redakcję.",
    "Kliknij „Podgląd tej wersji”: strona ma się pokazać z Twoją zmianą i paskiem informującym, że to podgląd.",
    "Wyślij dokładnie tę samą zmianę drugi raz. Potwierdzenie ma powiedzieć „Tę zmianę już zgłosiłeś”, a na karcie ma dalej być jedna propozycja, nie dwie.",
    "Otwórz „Zaproponuj zmianę” i wyślij formularz bez żadnej zmiany - w oknie ma się pojawić czerwony komunikat, że propozycja niczego nie zmienia.",
    "Jako admin sprawdź, że przy „Zaproponuj zmianę” jest przycisk „Rewizje” prowadzący do /admin/rewizje/<id spółki>; jako zwykły użytkownik tego przycisku ma nie być.",
  ],
  area: "contributor",
} satisfies QaItem;
