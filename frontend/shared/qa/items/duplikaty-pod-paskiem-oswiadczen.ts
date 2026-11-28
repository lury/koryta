import type { QaItem } from "../../qa";

export const order = 271;

export default {
  id: "duplikaty-pod-paskiem-oswiadczen",
  title: "„Duplikaty” zamiast „osobno imiennicy” pod paskiem oświadczeń",
  description:
    "Pod paskiem osób w zakładce „Oświadczenia” na głównej, na /oswiadczenia/postep i na /admin/oswiadczenia jest teraz „duplikaty:” z liczbą.",
  steps: [
    "Otwórz /oswiadczenia/postep: pod paskiem jest „duplikaty:” z liczbą, nie „osobno imiennicy:”.",
  ],
  link: "/oswiadczenia/postep",
  area: "public",
} satisfies QaItem;
