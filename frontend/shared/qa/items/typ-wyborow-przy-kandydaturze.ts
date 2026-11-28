import type { QaItem } from "../../qa";

export const order = 187;

export default {
  id: "typ-wyborow-przy-kandydaturze",
  title: "Typ wyborów da się poprawić przy kandydaturze",
  description:
    "Wiersz kandydatury pokazuje, jakie to były wybory - Sejm, Senat albo „Samorząd” - ale okno pod ołówkiem nie pozwalało tego zmienić. Teraz jest w nim pole „Typ wyborów” (także przy dodawaniu kandydatury), więc „Samorząd” można zawęzić do sejmiku, rady albo wójta.",
  steps: [
    "Jako zwykły użytkownik kliknij ołówek przy kandydaturze, wybierz inny „Typ wyborów” i zaproponuj zmianę - ma pojawić się „czeka na zatwierdzenie”, a admin ma ją widzieć na /admin/rewizje jako „typ wyborów” ze starym i nowym typem.",
    "Jako admin zrób to samo - wiersz ma od razu pokazać nowy typ, pogrubiony obok „kandydatura”.",
  ],
  link: "/osoba/kamil-sebastian-barczyk-qFxOI9faG9y0TuYuJAMc",
  area: "contributor",
  fixes: ["nA5jsYpXD9i8au8iLX10"],
} satisfies QaItem;
