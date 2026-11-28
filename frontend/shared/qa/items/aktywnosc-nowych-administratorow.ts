import type { QaItem } from "../../qa";

export const order = 147;

export default {
  id: "aktywnosc-nowych-administratorow",
  title: "Aktywność nowych administratorów da się oglądać osobno",
  description:
    "Administratorzy na okresie próbnym mają na /aktywnosc chip „okres próbny”, a przycisk „Nowi " +
    "administratorzy” zawęża listę do nich. Przy każdej decyzji widać powód, link do zmiany w " +
    "kolejce i ostrzeżenie „własna propozycja”, gdy ktoś zatwierdził albo opublikował to, co sam zaproponował.",
  steps: [
    "Z konta administratora, który nie jest na okresie próbnym: na /admin, w sekcji „Aktywni w tym tygodniu”, kliknij „Nowi administratorzy” - ma się otworzyć /aktywnosc z tym filtrem i listą osób na okresie próbnym.",
    "Przy decyzji z powodem (odrzucenie, usunięcie, scalenie) ma być widać ten powód, a link „zmiana” ma otwierać rewizję w kolejce.",
  ],
  link: "/aktywnosc?kto=nowi-admini",
  area: "admin",
} satisfies QaItem;
