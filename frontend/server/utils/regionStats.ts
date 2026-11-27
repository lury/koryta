import type { Person, Region } from "../../shared/model";
import { canonicalParty, paintedParty } from "../../shared/misc";

/** One row of the home map (`region_people_rows`, 0602_stats_sql.sql):
 * a region and its people, a powiat's by party too. `regionStat` and
 * `partyCounts` are the rules the view follows, kept as the oracle of
 * tests/server/db/statsSql.pg.test.ts. */
export interface RegionStat {
  id: string;
  teryt?: string;
  name?: string;
  people: number;
  /** A powiat's people by the party each is drawn in (`paintedParty`, SLD
   * under Nowa Lewica). Those with no party are `people` minus the sum.
   * Powiaty only: the map draws nothing else, and the rows travel to every
   * home page visit. */
  parties?: Record<string, number>;
}

export function regionStat(
  id: string,
  region: Partial<Region>,
  parties?: Record<string, number>,
): RegionStat {
  // Built field by field rather than as a literal: not every region node
  // carries a teryt or a name, and Firestore rejects a document with an
  // undefined value in it rather than dropping the field. Serving the row
  // straight out of a handler hid that - JSON drops undefined on its own.
  const stat: RegionStat = { id, people: region.stats?.people || 0 };
  if (region.teryt) stat.teryt = region.teryt;
  if (region.name) stat.name = region.name;
  if (parties) stat.parties = parties;
  return stat;
}

/** A powiat, as the home map draws it: four digits of teryt. */
export function isPowiat(region: Partial<Region>): boolean {
  return region.teryt?.length === 4;
}

/** How many of these people are drawn in each party. */
export function partyCounts(
  personIds: Iterable<string>,
  people: Record<string, Pick<Person, "parties"> | undefined>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of personIds) {
    const party = paintedParty(people[id]?.parties);
    if (!party) continue;
    const key = canonicalParty(party);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
