import type { QaItem } from "../../qa";

export const order = 156;

export default {
  id: "rewizje-jedna-strona",
  title: "Kolejka zmian i zmiany powiązań są teraz na stronie Rewizje",
  description:
    "/admin/rewizje ma trzy części: „Czeka na decyzję”, „Zmiany powiązań” i „Wpisy z historią zmian”. Każda pozycja to linijka, która po kliknięciu pokazuje autora, zmiany i decyzje, " +
    "a stare adresy /admin/rewizje/kolejka i /admin/rewizje-krawedzi prowadzą do właściwej części.",
  steps: [
    "Wejdź na /admin/rewizje i kliknij propozycję w „Czeka na decyzję” - ma pokazać autora, datę, różnicę i przyciski „Zatwierdź” i „Odrzuć”.",
    "Rozwiń wpis w „Wpisy z historią zmian” - ma pokazać wszystkie jego rewizje z autorami.",
    "Otwórz stary link /admin/rewizje/kolejka - ma przenieść do „Czeka na decyzję”.",
  ],
  link: "/admin/rewizje",
  area: "admin",
} satisfies QaItem;
