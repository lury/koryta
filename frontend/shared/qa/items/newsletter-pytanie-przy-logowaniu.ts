import type { QaItem } from "../../qa";

export const order = 215;

export default {
  id: "newsletter-pytanie-przy-logowaniu",
  title: "Pytanie o newsletter przy zakładaniu konta i logowaniu",
  description:
    "Zaraz po założeniu konta albo zalogowaniu - na stronie logowania i w okienku logowania z nagłówka - osoba spoza zespołu, która jeszcze nie odpowiedziała, dostaje jedno pytanie: czy chce dostawać nasz newsletter. W profilu karta „Newsletter” mówi teraz, na jaki adres go wysyłamy i kiedy ostatnio zmieniono to ustawienie.",
  steps: [
    "Załóż nowe konto na /login?konto=nowe - zamiast od razu wracać do poprzedniej strony, ma się pojawić „Chcesz dostawać nasz newsletter?”. Kliknij „Tak, zapisz mnie” - strona ma potwierdzić zapis i po kilku sekundach wrócić.",
    "Otwórz /profil - w karcie „Newsletter” oba tematy mają być włączone, a pod nimi data ostatniej zmiany.",
    "Wyloguj się i zaloguj tym samym kontem przez „Zaloguj się” w nagłówku - pytanie nie może się już pojawić.",
  ],
  link: "/login?konto=nowe",
  area: "contributor",
} satisfies QaItem;
