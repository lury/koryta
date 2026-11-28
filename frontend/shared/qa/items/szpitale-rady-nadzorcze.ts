import type { QaItem } from "../../qa";

export const order = 53;

export default {
  id: "szpitale-rady-nadzorcze",
  title: "Rady nadzorcze szpitali publicznych w podziale na partie",
  description:
    "Nowa strona pokazuje, z jakich partii są ludzie zasiadający w radach " +
    "nadzorczych szpitali publicznych. Rady społeczne SPZOZ są z zestawienia " +
    "wyłączone, bo zasiadanie w nich jest nieodpłatne - ale można je " +
    "obejrzeć osobno.",
  steps: [
    "Wejdź na /eksploruj/szpitale i sprawdź kafelki „W skrócie”.",
    "Przeczytaj pasek „Czym są nadzorowane szpitale publiczne” - szpitale w podziale na organ nadzoru mają się sumować do liczby szpitali z kafelków.",
    "Znajdź ramkę o radzie społecznej i sprawdź, że tłumaczy, dlaczego te miejsca są wyłączone, i podaje podstawę prawną.",
    "Przełącz przełącznik nad wykresem z „Rady nadzorcze” na „Rady społeczne” - wykres i tabela pod nim mają się zmienić razem.",
    "Sprawdź, że liczba wyłączonych miejsc podana w ramce zgadza się z tym, co widać po przełączeniu na „Rady społeczne”.",
    "Sprawdź w tabeli, że szpital prowadzony jako spółka ma radę nadzorczą, a SPZOZ radę społeczną albo „brak organu w KRS”.",
    "Sprawdź, że odnośnik w stopce prowadzi na tę stronę.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
