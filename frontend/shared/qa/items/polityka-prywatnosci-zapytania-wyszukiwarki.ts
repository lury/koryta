import type { QaItem } from "../../qa";

export const order = 275;

export default {
  id: "polityka-prywatnosci-zapytania-wyszukiwarki",
  title: "Polityka prywatności o zapytaniach z wyszukiwarki",
  description:
    "Polityka mówi teraz, że zapisujemy, czego czytelnicy szukają, i że trzymamy to 180 dni.",
  steps: [
    "Otwórz politykę prywatności: w punkcie 2, pod „W celach analitycznych i statystycznych”, jest akapit o treści zapytań, w punkcie 3 o 180 dniach i Plausible, a na dole data 17 listopada 2026r.",
  ],
  link: "/plik/polityka_prywatnosci",
  area: "public",
} satisfies QaItem;
