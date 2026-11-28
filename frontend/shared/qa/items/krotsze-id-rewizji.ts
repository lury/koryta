import type { QaItem } from "../../qa";

export const order = 118;

export default {
  id: "krotsze-id-rewizji",
  title: "Krótsze ID rewizji w porównaniu",
  description:
    "Na stronie porównania rewizji ID propozycji było tak długie, że " +
    "rozpychało kolumnę i wypychało nagłówek poza ekran. Teraz " +
    "pokazujemy tylko końcówkę identyfikatora, a pełne ID widać po " +
    "najechaniu myszą.",
  steps: [
    "Zaloguj się jako administrator i wejdź na /admin/rewizje.",
    "Otwórz węzeł, który ma rewizję zgłoszoną przez użytkownika (ID zaczynające się od „proposal_”).",
    "Sprawdź, że podpis w nagłówku kolumny czyta „ID: …” z samą końcówką i mieści się w kolumnie.",
    "Najedź myszą na ten podpis - w dymku systemowym pokazuje się pełne ID rewizji.",
  ],
  link: "/admin/rewizje",
  area: "admin",
} satisfies QaItem;
