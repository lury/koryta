import type { QaItem } from "../../qa";

export const order = 273;

export default {
  id: "procesy-kroki-nocy-w-harmonogramie",
  title: "Procesy: „Import firm” i „Oceny modeli” w „Według harmonogramu”",
  description:
    "Oba uruchamia noc, a stały w „Na żądanie”. Kroki nocy bez własnej godziny mają w wierszu „co noc” zamiast „jeszcze bez harmonogramu”.",
  steps: [
    "Otwórz /admin/procesy: „Import firm” i „Oceny modeli” są w „Według harmonogramu”, obok „Import osób na stronę”, i jak on mają po prawej „co noc”.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
