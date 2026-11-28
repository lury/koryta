import type { QaItem } from "../../qa";

export const order = 287;

export default {
  id: "okno-publikacji-propozycja-zmiany",
  title: "Okno publikacji mówi, gdy pokaże czyjąś propozycję zmiany",
  description:
    "Strona bez zatwierdzonej wersji wychodzi w najnowszej. Gdy to czyjaś propozycja zmiany, a nie wersja z importu, okno publikacji teraz to mówi.",
  steps: [
    "Na /admin/oswiadczenia wybierz powód „czeka propozycja zmiany od osoby” i kliknij „Opublikuj ręcznie” w kilku wierszach. Ramka u góry okna mówi, którą wersję pokaże, czasem „propozycję zmiany z …”. Zamknij okno bez publikacji.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
