import type { QaItem } from "../../qa";

export const order = 60;

export default {
  id: "ranking-wspolautorow-na-gorze",
  title:
    "Statystyki zaczynają się od tego, kto je tworzy — z zamazanymi nazwami i przełącznikiem w profilu",
  description:
    "Ranking „Najaktywniejsi” był na samym dole strony i widzieli go " +
    "wyłącznie administratorzy; wszyscy inni dostawali jedno zdanie o tym, " +
    "ile osób coś robiło. Teraz jest na górze i widzą go wszyscy, ale " +
    "nazwy są zamazane (A•••••) — dopóki ich właściciel nie włączy " +
    "widoczności w /profil. Swoje własne miejsce widzisz zawsze, także " +
    "wtedy, gdy wypadasz poza pokazaną dwudziestkę piątkę. Serwer nie " +
    "wysyła nikomu poza administratorem uid, adresu ani awatara osoby, " +
    "która się nie zgodziła.",
  steps: [
    "Otwórz /eksploruj/statystyki bez logowania: ranking jest pierwszą sekcją, nazwy są zamazane, a pod tabelą jest zaproszenie do zalogowania.",
    "Zaloguj się jako zwykły użytkownik i wróć na tę stronę: Twój wiersz jest podświetlony i podpisany „· Ty”, a zaproszenie zmienia się w „Pokaż moją nazwę”.",
    "Wejdź w /profil, w karcie „Widoczność w statystykach” zobacz podgląd zamazanej nazwy i włącz przełącznik.",
    "Wróć na /eksploruj/statystyki — po odświeżeniu (odpowiedź jest buforowana do 5 minut) Twoja nazwa jest widoczna, a zaproszenie mówi, że można ją schować z powrotem.",
    "Zaloguj się jako administrator: nazwy, adresy i odnośniki do kolejki rewizji są jak dotąd.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
