import {
  declarationPeopleSchema,
  type DeclarationPeople,
} from "~~/shared/declarations";

/**
 * Where the declarations stand in people: one document (`DeclarationPeople`)
 * the site counts whole from the facts the night sends, and moves during the
 * day for the people an event touches (server/utils/declarationPeopleCount.ts).
 */
export const PEOPLE_DOC = "declaration_people";

/** A stored snapshot read as one, from either backend. */
export function parseDeclarationPeople(
  data: unknown,
): DeclarationPeople | null {
  const parsed = declarationPeopleSchema.safeParse(data);
  if (!parsed.success) {
    console.error(
      `stats/${PEOPLE_DOC} does not read as a people snapshot:`,
      parsed.error.issues.slice(0, 3),
    );
    return null;
  }
  return parsed.data;
}
