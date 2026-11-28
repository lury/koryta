import type { QaItem } from "../../qa";

export const order = 25;

export default {
  id: "reviewer-queue-one-button",
  title: "Kolejka rewizji: jeden przycisk zamiast pięciu",
  description:
    "Wiersz w kolejce ma teraz jeden przycisk - „Rozpatrz” - który otwiera " +
    "porównanie rewizji tego wpisu z tą jedną podświetloną i przewiniętą " +
    "na widok. Decyzje zapadają tam, gdzie widać całą zmianę, a nie w " +
    "najwęższej kolumnie tabeli. Autor i data to jedna kolumna " +
    "„Zgłoszenie” na początku wiersza, a „Czego dotyczy” nie rozpycha się " +
    "już na tytuł artykułu.",
  steps: [
    "Jako admin wejdź na /admin/rewizje/kolejka.",
    "Sprawdź pierwszą kolumnę „Zgłoszenie” - w jednym miejscu ma być autor, kiedy zgłosił i status.",
    "Sprawdź ostatnią kolumnę - ma być w niej dokładnie jeden przycisk.",
    "Kliknij „Rozpatrz” - otwiera się porównanie rewizji tego wpisu, a kolumna z tą rewizją jest podświetlona i widoczna bez przewijania w bok.",
    "Zatwierdź albo odrzuć ją tam i wróć do kolejki - przycisk przy rozpatrzonej zmienia się na „Zobacz”.",
    "Ustaw filtr „Rodzaj” na „Wszystko” i znajdź rewizję powiązania - jej przycisk ma prowadzić na /admin/rewizje-krawedzi, bo powiązania recenzuje się tam.",
    "Znajdź rewizję artykułu o długim tytule - kolumna „Czego dotyczy” ma być wąska, tytuł ucięty po dwóch liniach, a cały widoczny w dymku po najechaniu.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
