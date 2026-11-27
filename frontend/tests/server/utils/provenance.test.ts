import { describe, it, expect } from "vitest";
import { writtenByImportOrReviewed } from "../../../server/utils/provenance";

describe("writtenByImportOrReviewed", () => {
  it("asks of a first revision in hand what the query asks of the stored one", () => {
    // computeNodes holds every revision, and must reach the teaser's answer.
    expect(writtenByImportOrReviewed({ revision_id: "r1" }, undefined)).toBe(
      true,
    );
    expect(writtenByImportOrReviewed({}, { update_automatic: true })).toBe(
      true,
    );
    expect(writtenByImportOrReviewed({}, { update_automatic: false })).toBe(
      false,
    );
    // No history at all is older than the question can be answered for.
    expect(writtenByImportOrReviewed({}, undefined)).toBe(false);
  });
});
