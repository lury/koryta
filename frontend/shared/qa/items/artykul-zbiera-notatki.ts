import type { QaItem } from "../../qa";

export const order = 87;

export default {
  id: "artykul-zbiera-notatki",
  title:
    "Strona artykułu pokazuje notatki napisane przy osobach i spółkach, a własne notatki są krótkie",
  description:
    "Źródło dopisane do notatki przy osobie jest notatką o tym artykule - " +
    "ale widać ją było tylko tam, gdzie ją napisano. Strona artykułu zbiera " +
    "je teraz wszystkie, razem ze stroną, przy której powstały: kilka " +
    "powodów, dla których różni ludzie trzymają ten sam tekst, obok tekstu. " +
    "Łączymy po artykule i po adresie, więc łapią się też notatki starsze " +
    "niż ta funkcja oraz zgłoszenia poprawek, które adres mają, a artykułem " +
    "nigdy się nie stają. Widoczne po zalogowaniu, bo notatki przy osobach " +
    "też są. Przy okazji notatka dodawana na samym artykule to teraz jeden " +
    "przycisk i pole tekstu - adres, który wpisywało się wcześniej, był " +
    "adresem strony, na której już jesteś.",
  steps: [
    'Zaloguj się, wejdź na stronę osoby i dodaj notatkę typu "Dodaj źródło" z adresem artykułu.',
    'Zapisz i poczekaj, aż pojawi się żeton "Artykuł".',
    "Przejdź nim na stronę artykułu.",
    'Sprawdź sekcję "Notatki z innych stron" - powinna być tam Twoja notatka z nazwiskiem osoby.',
    'Niżej dodaj notatkę do samego artykułu: powinien być jeden przycisk "Dodaj notatkę" i żadnego pola na adres.',
  ],
  area: "contributor",
} satisfies QaItem;
