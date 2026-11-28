import type { QaItem } from "../../qa";

export const order = 82;

export default {
  id: "statystyki-powiazan-duzych-wezlow",
  title: "Statystyki powiązań największych instytucji znów się przeliczają",
  description:
    "Liczby liczone z powiązań - staż, „obecnie zatrudniony”, lista " +
    "powiązanych podmiotów - nie odświeżały się dla węzłów mających " +
    "więcej niż 15 różnych powiązań. Zapytanie, które je przelicza, " +
    "przekraczało limit Firestore na złożoność i kończyło się błędem, a " +
    "błąd był po cichu połykany, więc statystyki zostawały takie, jakie " +
    "zostawił po sobie ostatni import. W ostatnim tygodniu sierpnia " +
    "dotyczyło to co najmniej 85 węzłów, w tym Warszawy i Krakowa - " +
    "czyli akurat tych, które mają najwięcej powiązań. Przy okazji samo " +
    "przeliczanie przeniosło się z „od razu przy każdej zmianie " +
    "powiązania” na „raz na minutę, zbiorczo”: pojedyncza zmiana jest " +
    "widoczna do minuty później, za to masowy import nie kosztuje już " +
    "milionów odczytów bazy.",
  steps: [
    "Wejdź na stronę instytucji z dużą liczbą powiązań, np. Miasto Warszawa.",
    "Sprawdź, że liczba powiązanych podmiotów w statystykach zgadza się z listą powiązań na stronie.",
    "Dodaj albo usuń jedno powiązanie i odczekaj minutę.",
    "Odśwież stronę - statystyki mają uwzględniać tę zmianę.",
    "W Eksploruj ustaw filtr „obecnie zatrudniony” i sprawdź, że osoby powiązane z tą instytucją są w wynikach.",
  ],
  area: "public",
} satisfies QaItem;
