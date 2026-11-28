import type { QaItem } from "../../qa";

export const order = 279;

export default {
  id: "start-kampania-w-plausible",
  title: "Wejścia przez koryta.pl/start widać w Plausible",
  description:
    "Wejścia przez koryta.pl/start mają w Plausible kampanię „start”. Źródło (Instagram, Facebook, wykop) zostaje.",
  steps: ["Wejdź na koryta.pl/start: adres ma ?utm_campaign=start."],
  link: "/start",
  area: "admin",
} satisfies QaItem;
