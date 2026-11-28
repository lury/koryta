import type { QaItem } from "../../qa";

export const order = 241;

export default {
  id: "admin-oswiadczenia-majatkowe",
  title: "Panel admina pokazuje, jak idzie odczytywanie dat z oświadczeń",
  description:
    "Nowa strona /admin/oswiadczenia: pasek oświadczeń według stanu, pod nim droga od kandydatury do publikacji, zakończona tym, ile osób automat opublikował dziś, a niżej sporne wycinki, daty inne niż na stronie, wstrzymane publikacje i ostatnio opublikowane osoby. Przycisk „Opublikuj z kolejki” publikuje od razu do 25 czekających osób, ponad dzienny limit, także przy wyłączonym publikowaniu automatycznym. Strony przechodzą te same sprawdzenia co przy publikacji automatycznej, w czasie importu osób (w tym nocnego, od 3:00 do 9:00) przycisk nikogo nie publikuje, a „Dziś” liczy tylko publikacje automatyczne. Otwarty wiersz spornego wycinka albo innej daty pokazuje wycinek, odczyty czytelników i strony osób, przy innej dacie także to, kto ją ustalił, a przy spornym wycinku daty ze stron są ukryte, dopóki się ich nie odkryje. Na jego dole admin przyjmuje datę, uznaje wycinek za nieczytelny albo go wycofuje. Data przyjęta przez admina sama nikogo nie publikuje ani nie podpina oświadczenia: szkic z tą datą trafia do wstrzymanych publikacji, a strona już publiczna zostaje bez zmian.",
  steps: [
    "W menu Admin wybierz „Oświadczenia majątkowe” (albo kafelek na /admin). Na górze jest pasek „Oświadczenia według stanu”, pod nim pięć etapów i „Dziś”: ile osób automat opublikował dziś z dziennego limitu. Dopóki limit wynosi 0 (tak jest po wdrożeniu), „Dziś” mówi „publikowanie automatyczne wyłączone”. Gdy ktoś czeka w kolejce, pod „Dziś” jest przycisk „Opublikuj z kolejki”, także przy limicie 0. Przed pierwszą przesyłką paska nie ma, etapy stoją na zerze, a zamiast list strona mówi „Zadanie jeszcze niczego nie przesłało”.",
    "Tylko jeśli chcesz opublikować czekające osoby, bo publikacja działa od razu: poza godzinami 3:00-9:00 kliknij „Opublikuj z kolejki”. Pytanie ma brzmieć „Opublikować teraz … z kolejki?”, a przy ustawionym limicie „… z kolejki, ponad dzisiejszy limit?”. Po „Opublikuj” komunikat mówi, ile osób opublikowano, ile wstrzymano i ile jeszcze czeka, a „Dziś” się nie zmienia. Opublikowane osoby są w „Opublikowane ostatnio”, a ich otwarty wiersz mówi „opublikowana przez administratora”.",
    "Gdy w sekcji „Sporne wycinki” jest choć jeden wiersz (wycinek trafia tam dopiero po kilku odpowiedziach czytelników bez zgody, a po pierwszej przesyłce, dopóki sporu nie ma, lista mówi „Żadnego sporu.”), otwórz go: ma pokazać wycinek, odczyty i strony bez ich dat, które pokazuje dopiero przycisk „Pokaż daty ze stron”. Nie podejmuj decyzji na próbę: każda od razu działa, a przyjęta data trafia do porównania ze stronami.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
