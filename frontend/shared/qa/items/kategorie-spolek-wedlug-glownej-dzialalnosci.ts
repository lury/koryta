import type { QaItem } from "../../qa";

export const order = 46;

export default {
  id: "kategorie-spolek-wedlug-glownej-dzialalnosci",
  title: "Więcej kategorii spółek, i trafniejszych",
  description:
    "Filtr „Kategoria” na Eksploruj miał trzy pozycje i mylił się w obie " +
    "strony. Spółka wpadała do kategorii, jeśli miała jej kod PKD " +
    "gdziekolwiek wśród dziesięciu zgłoszonych - a wodę i ścieki dopisuje " +
    "sobie prawie każdy zakład komunalny i każda duża fabryka, więc " +
    "„Wodociągi i kanalizacja” liczyły 674 spółki, z czego ćwierć to " +
    "ciepłownie, śmieciarki i zakłady chemiczne. Teraz decyduje " +
    "działalność przeważająca, czyli ta, którą spółka sama podaje jako " +
    "główną. Doszło sześć kategorii: Przychodnie, Ciepłownictwo, " +
    "Energetyka, Odpady i recykling, Komunikacja miejska i autobusowa " +
    "oraz Sport i rekreacja. Do „Szpitali” trafiły wreszcie 243 " +
    "samodzielne publiczne zakłady opieki zdrowotnej, które nie mają w " +
    "rejestrze ani jednego kodu PKD i przez to nie miały żadnej " +
    "kategorii. Spółka może być w dwóch kategoriach naraz i to nie jest " +
    "błąd: zakład gospodarki komunalnej dostarcza wodę i ciepło.",
  steps: [
    "Wejdź na Eksploruj → Tabela, kliknij „Filtry” i rozwiń listę „Typ podmiotu” (tak nazywa się filtr kategorii). Ma mieć wszystkie sektory, nie trzy pozycje.",
    "Wybierz „Ciepłownictwo”. Mają się pokazać przedsiębiorstwa energetyki cieplnej (MPEC, PEC, Ciepłownia), a nie wodociągi.",
    "Wybierz „Wodociągi i kanalizacja”. Nie powinno tam być ciepłowni ani zakładów chemicznych - sprawdź, że nie ma Grupy Azoty Puławy ani PCC Rokita.",
    "Wybierz „Szpitale” i poszukaj samodzielnego publicznego zakładu opieki zdrowotnej, np. SPZOZ w Sanoku. Wcześniej nie było go w żadnej kategorii.",
    "Wejdź na stronę spółki, która robi kilka rzeczy naraz (zakład gospodarki komunalnej), i sprawdź, że ma pod nazwą więcej niż jeden znacznik kategorii, a każdy prowadzi do filtra.",
    "Wybierz „Koleje” i sprawdź, że są tam operatorzy tramwajów (MPK Wrocław, MPK Kraków), a nie ma terminala Port Północny ani PKM Tychy.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
