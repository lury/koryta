import type { QaItem } from "../../qa";

export const order = 276;

export default {
  id: "oswiadczenia-jeden-wycinek-na-osobe",
  title: "Na /oswiadczenia jeden wycinek na osobę",
  description:
    "Kolejka daje każdej osobie jeden wycinek naraz, a wycinki osób już sprawdzonych idą na koniec. Te same odczyty sprawdzają więcej osób.",
  steps: [
    "Odczytaj kilka wycinków z rzędu: po każdym zapisie przychodzi następny.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
