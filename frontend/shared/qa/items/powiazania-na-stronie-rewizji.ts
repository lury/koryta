import type { QaItem } from "../../qa";

export const order = 228;

export default {
  id: "powiazania-na-stronie-rewizji",
  title: "Strona rewizji wpisu pokazuje jego powiązania i ich historię",
  description:
    "Propozycje zmian w powiązaniach i szkice powiązań nie trafiały do historii wpisu, więc strona osoby mogła czekać na decyzje, choć jej historia mówiła, że nic nie czeka. Teraz pod „Historią zmian” jest sekcja „Powiązania”: każde powiązanie z historią swoich rewizji, propozycje do zatwierdzenia albo odrzucenia, szkice do opublikowania, a pasek u góry strony mówi, ile czeka.",
  steps: [
    "Otwórz stronę rewizji Huberta Papaja - pod tytułem pasek „Powiązania czekają na decyzję” mówi, ile propozycji i szkiców czeka, a „Przejdź do powiązań” przewija do sekcji.",
    "W sekcji „Powiązania” filtr „Czekają” pokazuje tylko to, co czeka, a pierwsze powiązanie jest otwarte: jego rewizje od najnowszej, „Zatwierdź” i „Odrzuć” przy propozycjach, „Opublikuj powiązanie” przy szkicu.",
    "Na stronie rewizji wpisu, przy którym nic nie czeka, sekcja ma jedną linijkę „Żadne powiązanie nie czeka na decyzję.”, a „Wszystkie (n)” rozwija wszystkie powiązania.",
  ],
  link: "/admin/rewizje/jzPDzeNZMhPFPD2DH0ut",
  area: "admin",
} satisfies QaItem;
