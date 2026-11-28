import type { QaItem } from "../../qa";

export const order = 50;

export default {
  id: "spolki-skarbu-panstwa-maja-wlasciciela",
  title: "Spółki Skarbu Państwa mają wreszcie wpisanego właściciela",
  description:
    "KRS wskazuje Skarb Państwa jako udziałowca 110 spółek na stronie i " +
    "żadna z nich nie miała z nim narysowanego powiązania. Powód był " +
    "techniczny: właściciela rozpoznajemy albo po numerze KRS, albo po " +
    "kodzie TERYT gminy, a Skarb Państwa nie ma ani jednego, ani drugiego - " +
    "nie ma go w rejestrze i nie jest terytorium. Strona ma jednak własną " +
    "stronę „Skarb Państwa”, więc to ona jest teraz celem tych powiązań. " +
    "Spółki były i tak oznaczone jako publiczne, więc zmienia się nie to, " +
    "co o nich wiadomo, tylko to, że da się z nich przejść dalej: ze strony " +
    "Skarbu Państwa widać wszystkie te spółki, a z każdej z nich - " +
    "właściciela.",
  steps: [
    "Wejdź na stronę spółki Skarbu Państwa (np. Polska Grupa Zbrojeniowa) i sprawdź, że w powiązaniach jest „Skarb Państwa” jako właściciel.",
    "Kliknij „Skarb Państwa” - jego strona ma listować te spółki.",
    "Sprawdź na grafie takiej spółki, że linia do Skarbu Państwa jest podpisana „właściciel”, a nie „siedziba”.",
    "Sprawdź spółkę komunalną (np. wodociągi) - jej właścicielem ma dalej być gmina, a nie Skarb Państwa.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
