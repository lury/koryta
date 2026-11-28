import type { QaItem } from "../../qa";

export const order = 247;

export default {
  id: "oswiadczenia-data-osiem-cyfr",
  title: "Pole daty na /oswiadczenia samo wstawia kropki i czeka na 8 cyfr",
  description:
    "W pole daty wpisuje się same cyfry, a kropka pojawia się sama zaraz po dniu i po miesiącu: 15071979 to 15.07.1979. Część daty nic nam nie daje, więc przycisk zostaje „Pomiń”, dopóki nie ma wszystkich 8 cyfr, a gdy ktoś przestanie pisać wcześniej, przy etykiecie pola pojawia się „Wpisz wszystkie 8 cyfr.”.",
  steps: [
    "Na /oswiadczenia wpisz 15: w polu od razu jest 15. z kropką. Wpisz dalej 0719: pole pokazuje 15.07.19, a przycisk dalej „Pomiń”. Po około 3 sekundach przy „Data urodzenia” pojawia się „Wpisz wszystkie 8 cyfr.”. Dopisz 79: pole pokazuje 15.07.1979, obok jest „15 lipca 1979”, a przycisk zmienia się w „Zapisz”.",
    "Wpisz część daty i naciśnij Enter: nic nie znika, a napis przy etykiecie robi się czerwony. Kliknij wtedy „Pomiń”: pojawia się następny wycinek.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
