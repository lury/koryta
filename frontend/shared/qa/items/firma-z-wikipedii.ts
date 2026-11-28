import type { QaItem } from "../../qa";

export const order = 185;

export default {
  id: "firma-z-wikipedii",
  title: "Wikipedia na stronie firmy: link, właściciele i branża",
  description:
    "Strona firmy linkuje jej artykuł w Wikipedii, tak jak strona osoby - dobrany po numerze KRS podanym w artykule. Spółkom akcyjnym, którym rejestr nie podaje akcjonariuszy, właścicieli bierzemy z artykułu, a firmom bez branży z kodów PKD - branżę z jego kategorii. Gdy wśród tych właścicieli jest Skarb Państwa, samorząd albo spółka publiczna, choćby z udziałem mniejszościowym, firma i jej spółki zależne są publiczne.",
  steps: [
    "Po najbliższym imporcie firm otwórz stronę Energi - obok KRS ma być „Wikipedia: Artykuł z Wikipedii”, w „Właścicielach” Orlen, a wśród kategorii Energetyka.",
    "Otwórz stronę PKP Cargo - ma mieć oznaczenie „Instytucja publiczna” i PKP S.A. we „Właścicielach”, choć PKP ma w niej 33%. PKP Cargo Service, jej spółka zależna, też ma być publiczna.",
    "Kliknij „Zaproponuj zmianę” na stronie dowolnej firmy - pod numerem NIP ma być pole „Link do Wikipedii”.",
  ],
  area: "public",
} satisfies QaItem;
