import type { QaItem } from "../../qa";

export const order = 217;

export default {
  id: "polityka-prywatnosci-adres-kontaktowy",
  title: "Adres kontaktowy w polityce prywatności",
  description:
    "W sprawach ochrony danych osobowych polityka prywatności podaje teraz adres kontakt@koryta.pl.",
  steps: [
    "Otwórz politykę prywatności - w punkcie 1 ma być adres kontakt@koryta.pl, a na dole data aktualizacji 24 października 2026r.",
  ],
  link: "/plik/polityka_prywatnosci",
  area: "public",
} satisfies QaItem;
