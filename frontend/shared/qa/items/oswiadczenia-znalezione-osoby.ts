import type { QaItem } from "../../qa";

export const order = 242;

export default {
  id: "oswiadczenia-znalezione-osoby",
  title: "Lista osób, które znaleziono dzięki Twoim odczytom",
  description:
    "Zalogowana osoba widzi przy liczniku „Sprawdzono” i „Znaleziono” na /oswiadczenia przycisk „Zobacz listę”. Prowadzi on do /oswiadczenia/znalezione: tam są osoby znalezione dzięki Twoim odczytom, z linkiem do strony, urzędem z oświadczenia i informacją, czy strona jest już opublikowana.",
  steps: [
    "Zaloguj się i zapisz datę na /oswiadczenia. Pasek nad wycinkiem ma po prawej „Znalezione osoby zapisujemy na Twoim koncie” i przycisk „Zobacz listę”; na telefonie sam przycisk i „?”.",
    "Kliknij „Zobacz listę”. Na /oswiadczenia/znalezione każda osoba ma link do swojej strony, urząd z oświadczenia i „Opublikowana” albo „Szkic”. Gdy nikogo jeszcze nie ma, strona mówi, kiedy osoba trafia na listę.",
    "Wyloguj się i otwórz /oswiadczenia/znalezione: strona prosi o zalogowanie i po nim wraca na listę.",
  ],
  link: "/oswiadczenia/znalezione",
  area: "public",
} satisfies QaItem;
