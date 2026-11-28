import type { QaItem } from "../../qa";

export const order = 218;

export default {
  id: "link-z-malymi-literami-prowadzi-do-strony",
  title: "Stary link pisany małymi literami prowadzi do strony",
  description:
    "Do sierpnia strona podawała Google i serwisom społecznościowym swój adres z identyfikatorem zapisanym małymi literami, a taki adres kończył się błędem 404. Teraz przenosi na właściwą stronę - tak samo adres z kropką lub przecinkiem doklejonym na końcu.",
  steps: [
    "Otwórz /osoba/tadeusz-grzegorz-slawik-2gbeatnjnfjkauu1kuot - ma przenieść na stronę Tadeusza Sławika, z wielkimi literami w końcówce adresu.",
  ],
  link: "/osoba/tadeusz-grzegorz-slawik-2gbeatnjnfjkauu1kuot",
  area: "public",
} satisfies QaItem;
