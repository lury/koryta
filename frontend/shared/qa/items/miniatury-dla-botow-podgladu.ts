import type { QaItem } from "../../qa";

export const order = 308;

export default {
  id: "miniatury-dla-botow-podgladu",
  title: "Miniatury linków także na X i LinkedInie",
  description:
    "Boty, które rysują podgląd linku, mogą pobrać jego miniaturę. Pozostałe dalej jej nie pobierają.",
  steps: [
    "Otwórz /robots.txt: grupa z Twitterbot i LinkedInBot ma „Allow: /_og”, a grupa „*” dalej „Disallow: /_og”.",
    "Wklej na X (bez wysyłania) link do osoby albo do „Partie w czasie”: podgląd ma obrazek, a nie sam tytuł.",
  ],
  area: "public",
} satisfies QaItem;
