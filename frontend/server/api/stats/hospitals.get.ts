import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import type { HospitalStats } from "~~/server/utils/hospitalStats";
import { hospitalStatsFromDb } from "~~/server/db/stats";

/** Re-exported so a page can name the response without reaching into
 * `server/utils` - the same way /eksploruj/statystyki imports `DatabaseStats`
 * from stats/database.get. Types only: `server/` is not bundled for the
 * browser, so a page importing a *value* from here would not build. The
 * no-party sentinel is the literal `"__NONE__"` that /eksploruj/tabela already
 * filters on. */
export type {
  HospitalStats,
  HospitalRow,
  PartySeats,
  RegionRow,
  SupervisoryGroup,
} from "~~/server/utils/hospitalStats";

/** Supervisory boards of publicly owned hospitals, broken down by party:
 * `hospital_stats` (0603_hospital_stats.sql) over the tables node_stats'
 * refreshes keep, on today's date in UTC.
 *
 * Nothing here depends on who is asking.
 *
 * `editorFresh` rather than the plain cached wrapper, because the six hours are
 * held in two places and only one of them is ours: the wrapper emits
 * `s-maxage=21600`, so Cloud CDN keeps its own copy and no amount of
 * `useStorage("cache").clear()` on publication reaches it. An admin who has
 * just published a board member and reloads /eksploruj/szpitale was being shown
 * an edge-cached answer from before they did it, with nothing on the page
 * admitting it. On the `latest` path the response goes out `no-store`, which is
 * the only thing the CDN honours.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<HospitalStats> => {
    const now = new Date();
    return hospitalStatsFromDb(
      now.toISOString().slice(0, 10),
      now.toISOString(),
    );
  },
  {
    // Five minutes for a signed in reader, rather than nothing at all. This was
    // 47,056 Firestore reads in 28 hours across 272 `latest=true` calls - one
    // person reloading /eksploruj/szpitale, paying a scan of every place, every
    // hospital edge and every person on it each time, because `authFetch` marks
    // every request an editor makes as wanting the latest.
    //
    // The publish-and-reload case the note above is about still works: every
    // write path clears `nitro:handlers`, so the answer an admin is owed is
    // recomputed the moment they publish rather than waiting out this maxAge.
    // What it stops is the *second* identical load, which no write separates
    // from the first.
    editorMaxAge: 300,
  },
);
