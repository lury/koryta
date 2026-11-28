import type { QaItem } from "../../qa";

export const order = 248;

export default {
  id: "dzialaj-z-nami-na-oswiadczenia",
  title: "„Działaj z nami” i koryta.pl/start prowadzą na /oswiadczenia",
  description:
    "Odczytywanie dat z oświadczeń to zadanie, które każdy może zacząć od razu, bez konta, więc tam prowadzi teraz „Działaj z nami” w pasku u góry i na stronie głównej. Krótki adres koryta.pl/start do udostępniania też tam przekierowuje, a na dole /oswiadczenia jest link do pozostałych sposobów pomocy na /pomoc.",
  steps: [
    "Na komputerze kliknij „Działaj z nami” w pasku u góry: otwiera się /oswiadczenia. Wróć na stronę główną i kliknij przycisk „Działaj z nami” obok wyszukiwarki: też /oswiadczenia.",
    "Wpisz w pasek adresu koryta.pl/start: przeglądarka przechodzi na /oswiadczenia.",
    "Na /oswiadczenia przewiń na sam dół: pod kreską jest „Sprawdź inne sposoby pomocy na stronie - koryta.pl/pomoc”. Kliknij link: otwiera się /pomoc. Gdy nie ma już nic do odczytania, tej linijki nie ma, bo karta „Na razie wszystko odczytane” ma własny przycisk do /pomoc.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
