import type { QaItem } from "../../qa";

export const order = 27;

export default {
  id: "home-intro-and-no-cta-on-phone",
  title: "Strona główna na telefonie: zdanie, wyszukiwarka, mapa",
  description:
    "Na wąskim ekranie nad wyszukiwarką jest jedno zdanie o tym, co ta " +
    "strona robi - zabrakło go, kiedy logo i nagłówek zeszły z pierwszego " +
    "ekranu. Przycisk „Działaj z nami” znika z telefonów, żeby mapa " +
    "koryciarstwa była pierwszą rzeczą pod wyszukiwarką; ten sam " +
    "odnośnik jest teraz w stopce, więc dalej można do niego trafić.",
  steps: [
    "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na stronę główną - nad wyszukiwarką ma być jedno zdanie o tym, co robimy.",
    "Sprawdź, że pod wyszukiwarką nie ma już przycisku „Działaj z nami” i że zaraz pod nią zaczyna się mapa.",
    "Przewiń na sam dół - w stopce, w „O projekcie”, ma być „Działaj z nami”, prowadzące na /pomoc.",
    "Rozszerz okno powyżej 960 px - wraca logo, nagłówek i przycisk obok wyszukiwarki, a zdanie znika (mówi to samo, co nagłówek).",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
