import type { QaItem } from "../../qa";

export const order = 110;

export default {
  id: "regulamin-i-polityka-to-dwie-strony",
  title: "„Polityka prywatności” pokazuje politykę, a nie regulamin",
  description:
    "Kliknięcie w stopce „Polityka prywatności”, gdy było się na " +
    "„Regulaminie”, zmieniało adres, ale treść i tytuł karty zostawały " +
    "stare - i odwrotnie. Obie strony dzieliły jeden wpis w pamięci " +
    "podręcznej, więc druga nigdy się nie doczytywała. Wejście na adres " +
    "wprost zawsze działało; teraz działa też przejście z jednej na drugą.",
  steps: [
    "Wejdź na /plik/regulamin i zjedź do stopki.",
    "Kliknij „Polityka prywatności” - ma pojawić się polityka prywatności, a nie regulamin.",
    "Sprawdź, że tytuł karty w przeglądarce też się zmienił.",
    "Kliknij w stopce „Regulamin” - ma wrócić regulamin.",
  ],
  area: "public",
} satisfies QaItem;
