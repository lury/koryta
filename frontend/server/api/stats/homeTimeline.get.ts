import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { asArray } from "~~/shared/model";
import { canonicalParty, partyColors, partyMergedLabels } from "~~/shared/misc";
import { categoryTitle, isSector } from "~~/shared/companyCategories";
import { wojewodztwoLabel, wojewodztwoOf } from "~~/shared/teryt";
import { warsawDate } from "~~/shared/dates";
import {
  buildTimeline,
  effectiveEnd,
  type HeldPost,
  type Timeline,
} from "~~/shared/homeTimeline";
import {
  readTimelinePosts,
  readWojewodztwoNames,
  type TimelinePost,
} from "~~/server/db/edgeLists";

/** The dimensions the chart can be split by.
 *
 * The tuple is the source of truth and the type is derived from it, so the
 * response and the picker cannot drift apart.
 */
export const timelineGroupings = ["party", "region", "category"] as const;

export type TimelineGrouping = (typeof timelineGroupings)[number];

export type HomeTimelineResponse = {
  /** Every month the series cover, shared by all three groupings. */
  months: string[];
  /** One set of lines per grouping, all three computed together: the payload is
   * 26 kB, the reader switches between them with a click, and a request per
   * grouping would make that click wait on a scan of the whole edge collection.
   */
  groupings: Record<TimelineGrouping, Timeline["series"]>;
  /** How many posts each grouping could place, and how many distinct people
   * those are. Not equal across the three: every published post has a party
   * here, nearly all have a seat, and 42% carry a sector. The chart says so
   * rather than quietly drawing a smaller population. */
  coverage: Record<TimelineGrouping, { posts: number; people: number }>;
  /** How many published posts went into the whole computation, whichever
   * grouping can place them - the denominator the coverage is out of. */
  posts: number;
  /** The Warsaw month the series end on, `YYYY-MM`. */
  today: string;
};

/** The most edge documents one computation will read. Six times the 3,256
 * published employments on the 2026-09-12 export, so the ceiling is a guard
 * against a runaway query rather than a limit the data is near. */
const MAX_SCAN = 20000;

/** A nameless region is labelled with its teryt. */
type SeatRegion = { name: string | undefined; teryt: string };

/** The województwo an employer sits in, from its most specific seat.
 *
 * Only województwa: a powiat is the more specific answer and the one
 * `regionsByPlaceId` keeps, but sixteen lines is already past what a chart can
 * carry and 380 powiaty is not a grouping. A company's seat is a `seat` edge
 * from the region to the company, published ones only: a public, cached
 * endpoint places no company on a seat nobody approved.
 * `app/utils/companyLocation.ts` does the same walk in the browser.
 */
function seatOf(
  post: TimelinePost,
  wojewodztwa: Map<string, string>,
): SeatRegion | undefined {
  if (!post.seatTeryt) return undefined;
  const code = wojewodztwoOf(post.seatTeryt);
  if (!code) return undefined;
  const name = wojewodztwa.get(code);
  return {
    teryt: code,
    name:
      name !== undefined
        ? wojewodztwoLabel(name)
        : (post.seatName ?? undefined),
  };
}

/** Every published employment, as posts a timeline can count.
 *
 * The whole collection, because a monthly count is a fact about every post open
 * in that month and no query returns "the ones open in March 2016". That is the
 * same scan /api/edges/serviceMilestones does, for the same reason, and it is
 * why the result is cached for a day rather than computed per request: the
 * numbers only move when somebody publishes a page.
 *
 * Both ends are checked against the nodes rather than trusted from the edge.
 * The publish rule already refuses an edge whose ends are not both live and
 * unpublishing a node cascades to its edges - but the pipelines write this
 * collection too, and the nodes have to be read anyway to find the parties and
 * the sectors.
 *
 * Every published post counts, not only the ones in a state-owned company: a
 * page is on the site because an editor judged it worth publishing, so that
 * filter has been applied by hand already. `isPublic` would have dropped a
 * quarter of the posts, most of them companies nobody has classified yet rather
 * than companies known to be private.
 */
const cachedTimeline = defineCachedFunction(
  async (today: string): Promise<HomeTimelineResponse> => {
    const [posted, wojewodztwa] = await Promise.all([
      readTimelinePosts(MAX_SCAN),
      readWojewodztwoNames(),
    ]);

    const byGrouping: Record<TimelineGrouping, HeldPost[]> = {
      party: [],
      region: [],
      category: [],
    };
    const regionNames = new Map<string, string | undefined>();
    let posts = 0;

    for (const row of posted) {
      posts += 1;
      const post = {
        personId: row.person,
        start: row.start,
        end: effectiveEnd(row.end),
      };

      // `asArray`, not `.parties ?? []`: a node written before 2026-07-28 holds
      // `{"0": "PiS"}` where the array belongs, and reading it as an array loses
      // the value silently rather than failing.
      //
      // Only the parties the site has a colour for. One it has not is stored and
      // then invisible everywhere else - no chip, no graph legend - and a chart
      // is the wrong place to start showing them, a line with no colour of its
      // own being a line nobody can name.
      const parties = asArray<string>(row.parties)
        .filter((party) => typeof party === "string" && party in partyColors)
        .map(canonicalParty);
      if (parties.length > 0)
        byGrouping.party.push({ ...post, groups: parties });

      const seat = seatOf(row, wojewodztwa);
      if (seat) {
        regionNames.set(seat.teryt, seat.name);
        byGrouping.region.push({ ...post, groups: [seat.teryt] });
      }

      // Absent and empty differ on this field - absent means nobody has decided,
      // which is true of most companies - so a post with no sector is left out
      // of that grouping rather than counted as "other". `coverage` is what says
      // how many that is. Sectors alone: Skarb Państwa says who owns the
      // company, beside its sector (`isSector`).
      const categories = asArray<string>(row.categories).filter(
        (value) => typeof value === "string" && isSector(value),
      );
      if (categories.length > 0) {
        byGrouping.category.push({ ...post, groups: categories });
      }
    }

    const labels: Record<TimelineGrouping, (key: string) => string> = {
      party: (key) => partyMergedLabels[key] ?? key,
      region: (key) => regionNames.get(key) ?? key,
      category: categoryTitle,
    };
    const otherLabels: Record<TimelineGrouping, string> = {
      party: "Pozostałe partie",
      region: "Pozostałe województwa",
      category: "Pozostałe branże",
    };

    // The month the axis opens on, shared by all three. A sector was first
    // filed years after the first party was, and three sets of lines cannot
    // share an axis unless they are all cut to the same one.
    const from = timelineGroupings
      .flatMap((grouping) => byGrouping[grouping])
      .reduce<string | null>(
        (earliest, post) =>
          earliest === null || post.start < earliest ? post.start : earliest,
        null,
      );

    const groupings = {} as HomeTimelineResponse["groupings"];
    const coverage = {} as HomeTimelineResponse["coverage"];
    let months: string[] = [];

    for (const grouping of timelineGroupings) {
      const built = buildTimeline(byGrouping[grouping], today, {
        labelOf: labels[grouping],
        otherLabel: otherLabels[grouping],
        from: from ?? undefined,
      });
      groupings[grouping] = built.series;
      coverage[grouping] = {
        posts: byGrouping[grouping].length,
        people: new Set(byGrouping[grouping].map((post) => post.personId)).size,
      };
      if (built.months.length > months.length) months = built.months;
    }

    return { months, groupings, coverage, posts, today: today.slice(0, 7) };
  },
  {
    // A day. The series is 300-odd months long and its last point moves when
    // somebody publishes a page, which is not something a reader of the home
    // page is waiting on; an editor who wants it fresh passes `?latest`.
    maxAge: 86400,
    name: "homeTimeline",
    getKey: (today: string) => today,
  },
);

/** How many people held a post each month, split three ways.
 *
 * Feeds the „Wykres” panel of the home page explorer - the busiest route on the
 * site - so it is cached hard on both sides: a day in `cachedTimeline`, keyed on
 * the Warsaw day, behind the six-hour response cache every public endpoint has.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<HomeTimelineResponse> => cachedTimeline(warsawDate()),
  { name: "api-stats-homeTimeline" },
);
