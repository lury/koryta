import type { QaItem } from "../../qa";

export const order = 126;

export default {
  id: "linki-relacji-bez-przekierowania",
  title: "Linki w kartach powiązań prowadzą prosto do strony",
  description:
    "Wiersze w „Historii powiązań”, w historii zatrudnienia i na kartach " +
    "osób z regionu prowadziły pod adres /entity/…, który dopiero " +
    "przekierowywał na właściwą stronę. Teraz link od razu wskazuje " +
    "docelowy adres z nazwą, więc widać go po najechaniu myszą, można go " +
    "skopiować, a przycisk „wstecz” nie musi przeskakiwać przez adres " +
    "pośredni. Google indeksowało te przekierowania zamiast stron, na " +
    "które wskazują.",
  steps: [
    "Wejdź na stronę dowolnej osoby i najedź myszą na wiersz w sekcji „Historia powiązań”.",
    "W pasku stanu przeglądarki adres ma zawierać nazwę instytucji, a nie /entity/.",
    "Kliknij wiersz - powinien otworzyć tę samą stronę co dotąd.",
    "Kliknij „wstecz” - powinieneś wrócić na stronę osoby za jednym razem.",
  ],
  link: "/osoba/agnieszka-zurek-xQwaKwMSFZeDTc8Tz1Ce",
  area: "public",
} satisfies QaItem;
