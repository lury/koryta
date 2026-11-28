import type { QaItem } from "../../qa";

export const order = 23;

export default {
  id: "admin-feedback-settled-dimmed",
  title: "Załatwione zgłoszenia schodzą na drugi plan",
  description:
    "W kolejce zgłoszeń widać teraz na pierwszy rzut oka, czym nikt nie " +
    "musi się już zajmować: zgłoszenia ze statusem „Załatwione” i „Nie " +
    "robimy” są wyszarzone. Nie znikają - najechanie kursorem przywraca im " +
    "pełny kontrast.",
  steps: [
    "Jako admin wejdź na /admin/opinie.",
    "Ustaw jednemu zgłoszeniu status „Załatwione” - jego karta ma od razu zblednieć.",
    "Najedź na tę kartę kursorem - ma wrócić do pełnego kontrastu, a status dalej ma się dać zmienić.",
    "Ustaw innemu status „W trakcie” - ta karta ma zostać normalna, bo to wciąż robota do zrobienia.",
    "Kliknij na dole „Pokaż zamknięte” - pod „Zamknięte” mają być same wyszarzone karty.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
