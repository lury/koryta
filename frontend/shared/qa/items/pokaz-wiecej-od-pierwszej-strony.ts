import type { QaItem } from "../../qa";

export const order = 128;

export default {
  id: "pokaz-wiecej-od-pierwszej-strony",
  title: "Feed na stronie głównej dokłada wpisy dopiero po kliknięciu",
  description:
    "„Co nowego” dociągał dwie kolejne strony samo z siebie, zanim pokazał " +
    "przycisk. Teraz „Pokaż więcej” jest od razu i nic nie ładuje się " +
    "automatycznie.",
  steps: [
    "Wejdź na stronę główną i przewiń do końca sekcji „Co nowego”.",
    "Pod kaflami zobacz przycisk „Pokaż więcej” - lista nie rośnie sama.",
    "Kliknij go: dokładają się kolejne kafle, a przycisk zostaje.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
