import type { QaItem } from "../../qa";

export const order = 71;

export default {
  id: "scalony-duplikat-znika-z-list",
  title: "Scalony duplikat znika z tabeli i z podpowiedzi",
  description:
    "Scalona strona zostaje w bazie, żeby jej stary adres nadal " +
    "przekierowywał na tę, która została - ale znikała tylko dla " +
    "niezalogowanych. Zalogowany widział ją dalej w tabeli, bo „robocze” " +
    "znaczy „nieopublikowane”, a scalony duplikat jest właśnie " +
    "nieopublikowany. Trzymał się przy tym filtrów po pracodawcy, regionie " +
    "i „obecnie zatrudniony”, bo licznik posad liczył też powiązania " +
    "usunięte - a scalenie zostawia po sobie właśnie takie, kiedy to samo " +
    "zatrudnienie jest już na stronie, która została. Przeliczenie " +
    "statystyk tego nie naprawiało, bo liczyło je tak samo. Teraz scalone " +
    "strony nie wchodzą na listy, usunięte powiązanie nie liczy się do " +
    "niczego, a upload nie dopisze nowych faktów do scalonej strony - " +
    "trafiają na tę, która została.",
  steps: [
    "Przelicz statystyki (POST /api/stats/computeNodes) - liczniki policzone starą regułą zostają w bazie do następnego przeliczenia.",
    "Zaloguj się i otwórz /eksploruj/tabela z widocznością „robocze”. Żadna ze scalonych stron nie ma być wierszem - sprawdź po nazwisku kogoś, kogo scalałeś.",
    "Wejdź na stary adres scalonego duplikatu - ma nadal przekierowywać na stronę, która została.",
    "W formularzu powiązania zacznij wpisywać nazwisko scalonego duplikatu - do wyboru ma być tylko strona, która została.",
    "Weź osobę, której admin usunął posadę, i po przeliczeniu sprawdź jej wiersz w tabeli: nie ma jej już pokazywać jako obecnie zatrudnionej u tego pracodawcy ani wpadać w filtr po tym pracodawcy.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
} satisfies QaItem;
