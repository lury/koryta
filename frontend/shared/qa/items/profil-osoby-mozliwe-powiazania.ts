import type { QaItem } from "../../qa";

export const order = 223;

export default {
  id: "profil-osoby-mozliwe-powiazania",
  title: "Zapowiedź strony osoby mówi, że są możliwe powiązania polityczne",
  description:
    "Na stronie osoby bez opublikowanej strony niezalogowany czytelnik nie wiedział, że mamy o niej jakiekolwiek informacje partyjne. " +
    "Teraz, gdy partia jest zapisana, obok nazwiska stoi szary chip „???” z kolorowymi kropkami, jak w obecnym składzie spółki, a baner wymienia możliwe powiązania polityczne na początku tego, co pokaże logowanie. Samej partii nadal nie widać.",
  steps: [
    "Wylogowany kliknij w obecnym składzie MPWiK w Kamiennej Górze osobę z chipem „???”: na jej stronie ten sam chip stoi obok nazwiska, a baner zaczyna się od „Zaloguj się, by zobaczyć możliwe powiązania polityczne”.",
    "Najedź na chip (na telefonie stuknij w niego): podpowiedź mówi, że informacja o partii nie jest jeszcze zweryfikowana i widać ją tylko po zalogowaniu. Chip nie jest linkiem.",
    "Osoba bez zapisanej partii nie ma chipu, a jej baner wygląda jak dotąd.",
  ],
  link: "/instytucja/miejskie-przedsiebiorstwo-wodociagow-i-kanalizacji-kamienna-gora-KNZZ2oawiqTbeg8xztLX",
  area: "public",
} satisfies QaItem;
