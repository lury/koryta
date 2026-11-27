import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import { documentSchemas, nodeDocumentSchema } from "~~/shared/documents";

describe("document schemas", () => {
  it.each(Object.entries(documentSchemas))(
    "%s.schema.json is what `npm run schemas` writes",
    (collection, schema) => {
      const stored = JSON.parse(
        readFileSync(`shared/documents/json/${collection}.schema.json`, "utf8"),
      );
      const { title: _, ...rest } = stored;
      expect(rest).toEqual(
        z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
      );
    },
  );

  it("keeps a field it does not know, and refuses a wrong type", () => {
    const parsed = nodeDocumentSchema.parse({
      type: "person",
      name: "Anna Nowak",
      parties: ["PiS"],
      somethingNew: 1,
    });
    expect(parsed).toMatchObject({ somethingNew: 1 });
    expect(
      nodeDocumentSchema.safeParse({ type: "person", name: 3 }).success,
    ).toBe(false);
  });
});
