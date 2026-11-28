import type { QaItem } from "../../qa";

export const order = 289;

export default {
  id: "zadania-merge-decyzje-akcje-u-gory",
  title: "Zadania: merge z gałęzią, decyzje z przyciskami odpowiedzi",
  description:
    "Merge prowadzi gałąź i pokazuje, ile z niej jest na main. Decyzja ma pytanie i odpowiedzi do kliknięcia; po wyborze jest w toku w „Podjęte decyzje”, a zamyka się sama, gdy zamknięte jest wszystko, co z niej wynika. Status, priorytet, „Na mapie”, Edytuj i Kopiuj są u góry otwartego zadania. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania kliknij chip „Merge” i otwórz zadanie: na górze jest gałąź z linkami „Zmiany” i „GitHub”.",
    "Kliknij chip „Decyzje”, otwórz decyzję z odpowiedziami i wybierz jedną: decyzja przechodzi do „Podjęte decyzje”, a zadania, które na nią czekały, mogą ruszać.",
    "W otwartym zadaniu kliknij „Na mapie”: mapa otwiera się z tym zadaniem pośrodku.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
