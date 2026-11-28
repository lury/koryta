import type { QaItem } from "../../qa";

export const order = 252;

export default {
  id: "dzialaj-z-nami-na-telefonie",
  title: "„Działaj z nami” wraca na stronę główną na telefonie",
  description:
    "Na telefonie pod wyszukiwarką na stronie głównej znowu jest przycisk „Działaj z nami”, prowadzący na /oswiadczenia. Jest tak szeroki jak pole wyszukiwania i stoi dokładnie pod nim, a nie bardziej z lewej. Na komputerze stoi trochę bliżej wyszukiwarki.",
  steps: [
    "Na telefonie (albo w oknie węższym niż 600 px) wejdź na stronę główną: pod wyszukiwarką jest „Działaj z nami”, na całą szerokość pola, z krawędziami w linii z jego krawędziami, a pod nim zaczyna się mapa.",
    "Kliknij go: otwiera się /oswiadczenia.",
    "Na komputerze przycisk stoi obok wyszukiwarki, jak dotąd, tylko bliżej niej.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
