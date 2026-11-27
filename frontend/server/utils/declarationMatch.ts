import { isoDay } from "~~/shared/dates";
import type { LocalOffice } from "~~/shared/declarations";

/** How a settled crop meets a page, as plain functions of the stored
 * documents: what server/db/declarationPublish.ts writes by and what a page's
 * declarations are read by (/api/nodes/<id>/declarations), with no store. */

type Doc = Record<string, unknown>;

/** A declaration as a page links it. */
export type LinkedDeclaration = {
  url: string;
  year: number | null;
  unit: string;
  office: LocalOffice | null;
};

/** The unit and office of a crop, as the reading task names them, and as a
 * page that links the declaration does. */
export function unitOf(data: Doc): {
  unit: string;
  office: LocalOffice | null;
} {
  const unit = (Array.isArray(data.units) ? data.units[0] : undefined) as
    { unitName?: string; teryt?: string; office?: LocalOffice } | undefined;
  return {
    unit: unit?.unitName ?? (unit?.teryt ? `TERYT ${unit.teryt}` : ""),
    office: unit?.office ?? null,
  };
}

/** The settled full date of a crop, or null: a crop still read, read as a
 * year alone, unreadable or withdrawn compares with nothing. */
export function agreedDay(extract: Doc | undefined): string | null {
  if (extract?.status !== "agreed") return null;
  const agreed = extract.agreed as { value?: unknown; kind?: unknown } | null;
  if (agreed?.kind !== "date" || typeof agreed.value !== "string") return null;
  return isoDay(agreed.value) ? agreed.value : null;
}

/** The page's birth date as stored, "" for none. Compared as written, the way
 * both its writers - the import and the edit form - write it. */
export function birthDateOf(data: Doc | undefined): string {
  const value = data?.birthDate;
  return typeof value === "string" ? value.trim() : "";
}

export function declarationOf(extract: Doc): LinkedDeclaration {
  return {
    url: typeof extract.url === "string" ? extract.url : "",
    year:
      typeof extract.declarationYear === "number"
        ? extract.declarationYear
        : null,
    ...unitOf(extract),
  };
}

/** The declarations with one more, unless it is linked already: one file is
 * one declaration however many of its pages were cut. */
export function withDeclaration(
  declarations: readonly LinkedDeclaration[],
  declaration: LinkedDeclaration,
): LinkedDeclaration[] {
  const key = (d: LinkedDeclaration) => `${d.url}|${d.year}`;
  return declarations.some((d) => key(d) === key(declaration))
    ? [...declarations]
    : [...declarations, declaration];
}

/**
 * The declarations a page's record may show on the page
 * (/api/nodes/<id>/declarations): those of its crops that still confirm the
 * page's birth date as it stands, settled on that very day, each file once.
 * `crops` are the record's `extractIds` as stored now, in the record's order.
 *
 * An admin's date counts here, though the automation publishes nothing on it:
 * a page somebody published, or whose date an admin settled, shows its
 * declaration all the same (decision on 2026-11-18).
 *
 * The record lists the crops that matched when it was written, and nothing
 * takes one off it: since then a reviewer may have corrected the page's
 * date, and an admin may have withdrawn the crop or settled it on another
 * day, the page's new one included. So the crops are read again, the way
 * `publishPage` reads them, rather than the record trusted.
 */
export function confirmedDeclarations(
  crops: readonly Doc[],
  page: Doc,
): LinkedDeclaration[] {
  const born = birthDateOf(page);
  if (!born) return [];
  return crops
    .filter((crop) => agreedDay(crop) === born)
    .reduce<LinkedDeclaration[]>(
      (linked, crop) => withDeclaration(linked, declarationOf(crop)),
      [],
    );
}
