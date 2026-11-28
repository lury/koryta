import type { QaItem } from "../../qa";

export const order = 203;

export default {
  id: "import-nie-podmienia-wpisu-rejestru",
  title: "Import nie podmienia wpisu rejestr.io na stronie osoby",
  description:
    "Import mógł zamienić link do rejestr.io na stronie osoby na wpis jej imiennika - tak wyglądały dane Tadeusza Rozpary z 6.10. Teraz strona z linkiem do innego wpisu niż w danych nie dostaje z nich nic, a import zgłasza taką osobę w przebiegu jako nieudaną; ten sam wpis zapisany inaczej (z nazwiskiem po numerze) nadal jest poprawiany.",
  steps: [
    "Na stronie Tadeusza Rozpary kliknij „Wyślij dane tej osoby”, a gdy wysyłka się skończy, odśwież stronę - link do rejestr.io ma dalej prowadzić do wpisu 1220490.",
  ],
  link: "/entity/person/msll649JpWZMJ7K1yR4f",
  area: "admin",
} satisfies QaItem;
