import type { QaItem } from "../../qa";

export const order = 160;

export default {
  id: "qa-zgloszenia-do-zamkniecia",
  title: "Na /qa są zgłoszenia, które ta wersja strony poprawia",
  description:
    "Poprawkę zgłoszenia można teraz ogłosić linijką w kodzie, bez osobnego wpisu na tej liście. Administrator widzi takie otwarte zgłoszenia na górze „Do sprawdzenia”, z opisem zmiany i przyciskiem „Zamknij jako załatwione”.",
  steps: [
    "Na /qa rozwiń zgłoszenie w „Zgłoszenia do zamknięcia”, sprawdź zmianę tam, gdzie je zgłoszono, i zamknij je - po odświeżeniu ma go tu już nie być, a na /admin/opinie ma być zamknięte.",
  ],
  link: "/qa",
  area: "admin",
} satisfies QaItem;
