import { readDeclarationPeoplePg } from "~~/server/db/declarationReading";
import type { DeclarationPeople } from "~~/shared/declarations";

/**
 * How far the declarations got, in people, for the home page, /oswiadczenia/postep
 * and the admin overview. Public: counts only, nobody named.
 *
 * Counted each night and moved during the day, so five minutes here, which
 * is also the CDN's `s-maxage`: a write cannot drop the copies each instance
 * and the CDN keep, and a read is one document.
 */
export default defineCachedEventHandler(
  async (): Promise<{ people: DeclarationPeople | null }> => ({
    people: await readDeclarationPeoplePg(),
  }),
  { name: "declarations-people", maxAge: 300, swr: true },
);
