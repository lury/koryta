import type { QaItem } from "../../qa";

export const order = 181;

export default {
  id: "wyslij-dane-na-zadanie",
  title: "Wysyłka danych firmy albo osoby na żądanie",
  description:
    "Zespół danych może ze strony firmy albo osoby zlecić wysłanie wszystkiego, co o niej wiemy, od razu, a nie czekać na noc. Strona firmy wysyła jej ludzi - tym, których serwis nie ma, zakłada nieopublikowane strony - a strona osoby tylko tę osobę. Każde zlecenie ma swój link na /admin/procesy, pod którym widać, jak idzie.",
  steps: [
    "Na stronie dowolnej spółki z numerem KRS kliknij „Wyślij dane osób”, zaznacz „Tylko policz - nic nie wysyłaj” i „Policz” - okno ma pokazać „Zlecone.” i link „Śledź postęp na stronie Procesy”.",
    "Kliknij ten link - /admin/procesy ma pokazać na górze kartę zlecenia z nazwą spółki, stanem „w kolejce” albo „trwa” i tym, czy maszynę uruchomiono, a w „Na żądanie” wiersz „Wysyłka osób na żądanie”.",
    "Na stronie osoby kliknij kwadratowy przycisk ze strzałką do bazy („Wyślij dane tej osoby”) - okno ma mówić, że nowej strony nie zakładamy, i pokazywać ostatnie zlecenia dla tej osoby.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
