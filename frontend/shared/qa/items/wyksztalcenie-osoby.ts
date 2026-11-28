import type { QaItem } from "../../qa";

export const order = 64;

export default {
  id: "wyksztalcenie-osoby",
  title: "Wykształcenie w danych osoby",
  description:
    "Karta osoby ma nowe pole „Wykształcenie”, do wpisania w oknie " +
    "propozycji zmiany i pokazywane w szczegółach obok daty urodzenia. To " +
    "zwykły tekst, a nie lista poziomów, bo użyteczna odpowiedź bywa " +
    "stopniem („magister inżynierii środowiska”), a bywa formacją, której " +
    "żadna skala stopni nie obejmuje („duchowny prawosławny”). Pole jest " +
    "puste wszędzie, dopóki ktoś go nie wypełni - żaden import go nie " +
    "uzupełnia.",
  steps: [
    "Wejdź na stronę osoby i sprawdź, że w szczegółach nie ma „Wykształcenie”, dopóki nikt go nie podał.",
    "Kliknij ołówek („Zaproponuj zmianę”) i sprawdź, że pod datą urodzenia jest pole „Wykształcenie” z podpowiedzią przykładów.",
    "Wpisz np. „magister inżynierii środowiska” i wyślij propozycję.",
    "Sprawdź w kolejce rewizji, że zmiana jest opisana jako „wykształcenie”, a nie angielską nazwą pola.",
    "Zatwierdź ją i sprawdź, że na stronie osoby pojawiło się „Wykształcenie” z tą treścią.",
    "Otwórz okno propozycji zmiany jeszcze raz - pole ma być wypełnione tym, co już zapisano.",
  ],
  area: "contributor",
} satisfies QaItem;
