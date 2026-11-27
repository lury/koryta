import type {
  NotesBreakdown,
  PeopleBreakdown,
  PlacesBreakdown,
  PublicationBucket,
  VotesBreakdown,
} from "~~/server/utils/databaseStats";
import { databaseStatsFromDb } from "~~/server/db/stats";

export type DatabaseStats = {
  /** When the numbers were computed, so a cached page can say how fresh it is. */
  generatedAt: string;
  nodes: {
    total: number;
    people: number;
    places: number;
    articles: number;
    regions: number;
  };
  people: PeopleBreakdown;
  /** Positively rated people, by score and by whether they are published yet. */
  publicationCandidates: PublicationBucket[];
  places: PlacesBreakdown;
  /** Connections in the graph: employment, party membership, mentions. */
  edges: number;
  notes: NotesBreakdown;
  revisions: {
    total: number;
    /** Nodes whose latest revision is not the approved one. */
    unapprovedNodes: number;
  };
  votes: VotesBreakdown;
  extractions: {
    total: number;
    /** Facts a human has already ruled on. */
    reviewed: number;
  };
  comments: number;
};

/** The state of the database in one response: how much is in it, how much of it
 * anybody has checked, and how the community's verdicts are distributed.
 *
 * Nothing here depends on who is asking and nothing here names a person, so the
 * whole thing is computed once and shared. The census is the nightly
 * recount's last step (`refresh_database_counts`, 0606), and `generatedAt` is
 * when it ran.
 */
export default defineCachedEventHandler(
  async (): Promise<DatabaseStats> => {
    const { counts, at } = await databaseStatsFromDb();
    return {
      generatedAt: at,
      nodes: {
        total:
          counts.people.total +
          counts.places.total +
          counts.articles +
          counts.regions,
        people: counts.people.total,
        places: counts.places.total,
        articles: counts.articles,
        regions: counts.regions,
      },
      people: counts.people,
      publicationCandidates: counts.publicationCandidates,
      places: counts.places,
      edges: counts.edges,
      notes: counts.notes,
      revisions: counts.revisions,
      votes: counts.votes,
      extractions: counts.extractions,
      comments: counts.comments,
    };
  },
  { name: "stats-database", maxAge: 21600, swr: true },
);
