import type { QaItem } from "../../qa";

export const order = 272;

export default {
  id: "poparcie-pkw-na-kandydaturach",
  title: "Poparcie i członkostwo z PKW na kandydaturach",
  description:
    "Przed komitetem kandydatury: partia, która według PKW poparła kandydata (ramka z paskiem w kolorze partii) albo nazwa organizacji, i partia, do której kandydat należał, gdy lista jej nie wymienia. Partia znana tylko z poparcia ma tę samą ramkę w nagłówku osoby. Dane PKW dochodzą z kolejnymi nocami.",
  steps: [
    "Na stronie Barbary Ewy Kamińskiej kandydatura na prezydenta Opola w 2018 ma PO i PSL w ramce. Najedź na PSL: ma pokazać słowa PKW. W nagłówku PSL ma stać po PO, w ramce.",
    "Na stronie Jacka Orycha kandydatury z 2018 i 2024 mają mieć „poparcie Mareckie Stowarzyszenie Gospodarcze”.",
  ],
  link: "/osoba/9Wp0FozK4aiokVSnizop",
  area: "public",
} satisfies QaItem;
