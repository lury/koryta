import type { QaItem } from "../../qa";

export const order = 195;

export default {
  id: "zlecenie-czeka-na-kopie-bazy",
  title: "Zlecenie sprzed 04:00 czeka na kopię bazy",
  description:
    "„Wyślij dane” kliknięte między północą a porannym eksportem kończyło się błędem „brak dzisiejszej kopii bazy”. Teraz czeka w kolejce - karta mówi „czeka na kopię bazy” - i rusza, gdy kopia jest gotowa, najpóźniej po 04:15, gdy maszyna włącza się na noc.",
  steps: [
    "Po północy kliknij na stronie spółki „Wyślij dane osób” i otwórz link do przebiegu - karta ma mieć „czeka na kopię bazy”, a rano przebieg ma być udany.",
    "Kilka minut później kliknij „Wyślij” jeszcze raz - okno ma napisać, że zlecenie czeka na dzisiejszą kopię bazy, a nie że maszyna się uruchamia.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
