import type { QaItem } from "../../qa";

export const order = 214;

export default {
  id: "maile-pytanie-i-wypisywanie",
  title: "Maile od koryta.pl: pytanie o zgodę i wypisywanie się",
  description:
    "Zalogowanym osobom spoza zespołu pokazujemy raz pytanie, czy chcą dostawać od nas maile - o tym, gdzie potrzebna jest pomoc, i o nowo znalezionych osobach. Każdy taki mail ma link „Wypisz się”, a admini mogą w profilu wyłączyć wiadomości dla zespołu.",
  steps: [
    "Zaloguj się kontem bez uprawnień admina, które nigdy nie zmieniało ustawień newslettera, i nie odpowiadaj na pytanie o newsletter. Przejdź na inną stronę przez pasek adresu - w lewym dolnym rogu ma się pojawić „Chcesz dostawać nasz newsletter?”. Kliknij „Nie, dziękuję” - okienko ma zniknąć i nie wrócić po odświeżeniu.",
    "Otwórz /profil - w karcie „Newsletter” oba tematy mają być wyłączone. Kontem admina zobaczysz tam też przełącznik „Wiadomości dla zespołu”.",
    "Otwórz link „Wypisz się” z maila od koryta.pl - strona ma zapytać, zanim cokolwiek zmieni, a po kliknięciu „Wypisz mnie” potwierdzić, że Cię wypisała.",
  ],
  link: "/profil",
  area: "contributor",
} satisfies QaItem;
