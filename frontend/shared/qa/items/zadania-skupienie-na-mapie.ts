import type { QaItem } from "../../qa";

export const order = 170;

export default {
  id: "zadania-skupienie-na-mapie",
  title: "Zadania: mapa skupiona na jednym zadaniu",
  description:
    "Przycisk obok zwijania na karcie mapy zostawia na niej tylko to zadanie i wszystko, na co czeka - wprost albo przez inne zadania. „Cała mapa” na pasku nad mapą przywraca resztę. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania?widok=mapa najedź na kartę, do której prowadzą strzałki, i kliknij przycisk obok zwijania - mają zostać tylko ona i zadania, od których strzałki prowadzą do niej; „Cała mapa” ma przywrócić resztę wokół tej karty.",
    "Skup mapę na zadaniu, otwórz je i kliknij zadanie w jego „Blokuje” - mapa ma wrócić cała, z tamtym zadaniem na środku.",
  ],
  link: "/admin/zadania?widok=mapa",
  area: "admin",
} satisfies QaItem;
