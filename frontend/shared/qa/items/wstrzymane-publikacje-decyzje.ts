import type { QaItem } from "../../qa";

export const order = 285;

export default {
  id: "wstrzymane-publikacje-decyzje",
  title:
    "Wstrzymane publikacje: opublikuj ręcznie, sprawdź ponownie albo odłóż",
  description:
    "Sekcja „Wstrzymane publikacje” na /admin/oswiadczenia pokazuje wszystkie wstrzymane osoby, nie 20 najnowszych, z filtrem powodu, a wiersze mają przyciski decyzji. Osoby bez płatnego stanowiska i odłożone są w nowej sekcji „Nie do publikacji”. Strona opublikowana ręcznie znika z listy i pokazuje oświadczenie.",
  steps: [
    "Wejdź na /admin/oswiadczenia. Przy „Wstrzymane publikacje” jest liczba wszystkich wstrzymanych i pole „Powód”. Wybierz powód: lista się zawęża.",
    "Rozwiń wiersz z powodem „kandydatura w dwóch miejscach naraz”, osoby, którą i tak trzeba opublikować, i kliknij „Opublikuj ręcznie”: otwiera się okno publikacji tej osoby. Zaznacz kandydaturę z miejsca oświadczenia. Jeśli okno ostrzega o partii imiennika, usuń ją na stronie osoby („Zaproponuj zmianę”) i wróć do okna. Opublikuj: wiersz od razu znika, a strona osoby jest publiczna i ma notkę z oświadczeniem.",
    "Kliknij „Sprawdź ponownie” w innym wierszu: komunikat mówi, czy strona wyszła, czy nadal jest wstrzymana i dlaczego.",
    "Kliknij „Nie publikuj”: osoba od razu przechodzi na górę sekcji „Nie do publikacji”. Kliknij tam „Przywróć”: wraca na górę wstrzymanych.",
    "Rozwiń wiersz w „Nie do publikacji” z powodem „brak płatnego stanowiska”: ma tylko „Opublikuj ręcznie”.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
