import type { QaItem } from "../../qa";

export const order = 264;

export default {
  id: "brak-polaczenia-w-panelu-admina",
  title: "Panel admina bez sieci: „Brak połączenia z siecią” zamiast błędu 500",
  description:
    "Strona admina otwarta bez połączenia z Firebase, gdy logowanie trzeba było odświeżyć, pokazywała „500 Coś poszło nie tak”. Teraz pokazuje „Brak połączenia z siecią” i przycisk „Odśwież stronę”.",
  steps: [
    "Zamknij koryta.pl na ponad godzinę. Potem w nowej karcie otwórz DevTools, zablokuj securetoken.googleapis.com i wejdź na /admin: jest „408 Brak połączenia z siecią”.",
    "Odblokuj adres i kliknij „Odśwież stronę”: otwiera się panel.",
  ],
  link: "/admin",
  area: "admin",
} satisfies QaItem;
