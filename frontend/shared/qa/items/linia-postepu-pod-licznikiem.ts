import type { QaItem } from "../../qa";

export const order = 293;

export default {
  id: "linia-postepu-pod-licznikiem",
  title: "Linia postępu na dole licznika na /oswiadczenia",
  description:
    "Licznik na /oswiadczenia kończy się cienką linią: ile osób już odczytano, ile czeka, a na końcu odczytanych Twoje odczyty. Liczby pokazuje po najechaniu albo dotknięciu.",
  steps: [
    "Odczytaj wycinek na /oswiadczenia: licznik kończy się linią.",
    "Najedź na nią albo dotknij jej na telefonie: pod nią są osoby gotowe i czekające oraz Twoje odczyty.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
