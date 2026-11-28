import type { QaItem } from "../../qa";

export const order = 38;

export default {
  id: "wyszukiwarka-szersza-na-komputerze",
  title: "Wyszukiwarka na głównej znów szeroka na komputerze",
  description:
    "Na komputerze pole wyszukiwania na stronie głównej sięga znów do dwóch " +
    "trzecich szerokości - tam, gdzie kończyła się kolumna, w której " +
    "stało wcześniej. Zwężone do 400 px kończyło się w jednej trzeciej, " +
    "przez co przycisk „Działaj z nami”, który ma być jego towarzyszem, " +
    "zaczynał się mniej więcej na środku pustej linii i wyglądał na " +
    "przycisk, który się obluzował. Na telefonie nic się nie zmienia - " +
    "pole nadal zajmuje całą linię, a przycisku tam nie ma.",
  steps: [
    "Wejdź na stronę główną na komputerze. Pole wyszukiwania ma sięgać mniej więcej dwóch trzecich szerokości, a „Działaj z nami” ma stać tuż za nim.",
    "Zwęź okno poniżej 960 px. Przycisk ma zniknąć, a pole zająć całą linię.",
    "Na telefonie sprawdź, że nad polem nadal jest zdanie o tym, co robi strona, a pod nim mapa koryciarstwa.",
    "Wpisz nazwisko - podpowiedzi mają się pokazywać jak wcześniej, na całej szerokości pola.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
