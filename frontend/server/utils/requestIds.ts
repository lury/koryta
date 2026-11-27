import { z } from "zod";

/** A row id as a request may name one. Ids keep the shape Firestore gave them
 * (carried over in the import, or made by `newDocId`), so none is longer than
 * 1,500 bytes or holds a `/`; anything else names no row and is refused before
 * a query is sent. */
export const documentId = z
  .string()
  .min(1)
  .max(1500)
  .regex(/^[^/]+$/, "Identyfikator nie może zawierać „/”.");

/** The same, where a blank value means the parameter was not given - which is
 * how the handlers read `?nodeId=` before they were validated. */
export const optionalDocumentId = z.literal("").or(documentId).optional();
