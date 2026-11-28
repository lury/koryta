import type { QaItem } from "../../qa";

export const order = 221;

export default {
  id: "opis-w-wyszukiwarce",
  title: "Google i podgląd linku opisują osobę albo spółkę konkretnie",
  description:
    "Opis strony był tym samym zdaniem na każdej stronie, więc Google pokazywał zamiast niego sklejony tekst strony („Zarząd1 osoba. RB. Romuald BosakowskiPO.”). " +
    "Teraz spółka wymienia obecny zarząd i radę z partiami, osoba swoje obecne i dawne stanowiska, a tekst strony czyta się poprawnie.",
  steps: [
    "Wklej link do /instytucja/bionanopark-lodz-xkbMYbTDimmGKKmPMsdZ w komunikatorze - podgląd ma zaczynać się od „BIONANOPARK (Łódź). Zarząd: Romuald Bosakowski (PO), od 28 sierpnia 2026”.",
    "Tak samo z /osoba/bartlomiej-wladyslaw-pachis-tPf22ihbbuHFWO0QCZwC - stanowisko stoi w nawiasie po nazwie spółki: „Obecnie: ZAKŁAD UNIESZKODLIWIANIA ODPADÓW (Szczecin, Rada Nadzorcza), od 28 stycznia 2025”.",
  ],
  link: "/instytucja/bionanopark-lodz-xkbMYbTDimmGKKmPMsdZ",
  area: "public",
} satisfies QaItem;
