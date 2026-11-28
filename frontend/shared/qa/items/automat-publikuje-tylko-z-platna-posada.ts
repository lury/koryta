import type { QaItem } from "../../qa";

export const order = 253;

export default {
  id: "automat-publikuje-tylko-z-platna-posada",
  title:
    "Automat publikuje z oświadczeń tylko osoby na płatnej posadzie publicznej",
  description:
    "Strona sama publikuje osobę z odczytanego oświadczenia tylko wtedy, gdy ma na stronie pracę albo funkcję w firmie, o której wiadomo, że należy do sektora publicznego, i za którą ktoś płaci. Sama kandydatura nie wystarcza: oświadczenie składa każdy radny. Z tego samego powodu czytelnicy dostają teraz do odczytania najpierw wycinki tych osób, które taką posadę mają.",
  steps: [
    "Wejdź na /admin/oswiadczenia i rozwiń sekcję „Nie do publikacji”: osoby bez takiej posady mają powód „brak płatnego stanowiska”.",
    "Rozwiń taki wiersz: notatka mówi, że po dodaniu posady osoba wróci do wstrzymanych, a „Opublikuj ręcznie” publikuje ją od razu.",
    "Naciśnij „Opublikuj z kolejki”: taka osoba nie wychodzi, zostaje w „Nie do publikacji”.",
    "Otwórz stronę takiej osoby i opublikuj ją ręcznie: to działa jak dotąd, automat nikomu nie blokuje publikacji.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
