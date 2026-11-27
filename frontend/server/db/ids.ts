import { randomInt } from "node:crypto";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A new document id shaped like Firestore's `add()` ids (20 characters of
 * [A-Za-z0-9]), so ids made on either backend read the same in urls. */
export function newDocId(): string {
  let id = "";
  for (let i = 0; i < 20; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}
