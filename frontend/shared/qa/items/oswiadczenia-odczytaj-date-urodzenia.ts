import type { QaItem } from "../../qa";

export const order = 239;

export default {
  id: "oswiadczenia-odczytaj-date-urodzenia",
  title: "Odczytaj datę urodzenia z oświadczenia majątkowego",
  description:
    "Nowa strona /oswiadczenia: przepisujesz datę urodzenia z wyciętej linijki oświadczenia majątkowego, a strona mówi, jak zrozumiała wpisaną datę. Bez konta też można czytać: odczyty zapisujemy w przeglądarce i przechodzą na konto po zalogowaniu.",
  steps: [
    "Otwórz /oswiadczenia: pod wycinkiem jest pole „Data urodzenia” i przycisk „Pomiń”. Wpisz datę, którą widzisz na wycinku - przycisk zmienia się w „Zapisz”, a przy etykiecie pola pojawia się ta sama data słownie. Zapisz: pod następnym wycinkiem ma być „Zapisane: ...” z tą datą i link „Zobacz całe oświadczenie”. Nie wpisuj daty, której nie widzisz - kliknij wtedy „Pomiń”.",
    "Otwórz /oswiadczenia w oknie prywatnym: wycinek widać bez logowania i nic nie prosi o konto. Po pierwszej zapisanej dacie nad wycinkiem pojawia się pasek „Sprawdzono” i „Znaleziono” z przyciskiem „Zaloguj się”, który otwiera logowanie na tej stronie. Na telefonie obok jest „?”, który rozwija pod paskiem, po co się logować; na komputerze ten tekst stoi obok przycisku.",
    "Zapisz kilka dat: „Znaleziono” rośnie od razu po każdej, bez czekania na innych czytających. Ta sama osoba liczy się raz, a data inna niż data urodzenia na stronie tej osoby się nie liczy.",
    "Na /pomoc, w „Więcej do sprawdzania”, karta „Odczytuj daty urodzenia z oświadczeń” ma znaczek „bez konta” i prowadzi na /oswiadczenia.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
