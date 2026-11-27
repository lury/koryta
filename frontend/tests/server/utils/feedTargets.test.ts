import { describe, expect, it } from "vitest";
import {
  isFeedDocId,
  unreadFeedTarget,
  type FeedTargetRef,
} from "../../../server/utils/feedTargets";

describe("isFeedDocId", () => {
  it("accepts what Firestore accepts as a document id", () => {
    expect(isFeedDocId("p1")).toBe(true);
    expect(isFeedDocId("proposal_p1_uid_abc")).toBe(true);
    expect(isFeedDocId("_x_")).toBe(true);
  });

  it("rejects what would throw or name something else", () => {
    for (const id of ["", "a/b", ".", "..", "__name__", "x".repeat(1501), 7]) {
      expect(isFeedDocId(id)).toBe(false);
    }
    // 1,500 bytes, not characters: "ł" is two.
    expect(isFeedDocId("ł".repeat(750))).toBe(true);
    expect(isFeedDocId("ł".repeat(751))).toBe(false);
  });
});

describe("unreadFeedTarget", () => {
  it("types a target by what its reference says, and reads nothing", () => {
    expect(unreadFeedTarget({ collection: "edges", id: "e1" })).toEqual({
      collection: "edges",
      id: "e1",
      type: "edge",
      unread: true,
    });
    expect(unreadFeedTarget({ collection: "extractions", id: "f1" })).toEqual({
      collection: "extractions",
      id: "f1",
      type: "fact",
      unread: true,
    });
    expect(
      unreadFeedTarget({
        collection: "nodes",
        id: "n1",
        proposed: { name: "Nowa Osoba", type: "place" },
      }),
    ).toEqual({ collection: "nodes", id: "n1", type: "place", unread: true });
  });

  it("leaves a page untyped when nothing says what it is", () => {
    // A vote's or a note's page, and a revision whose type is not one.
    for (const ref of [
      { collection: "nodes", id: "n1" },
      { collection: "nodes", id: "n1", proposed: { type: "bogus" } },
    ] satisfies FeedTargetRef[]) {
      expect(unreadFeedTarget(ref)).toEqual({
        collection: "nodes",
        id: "n1",
        unread: true,
      });
    }
  });
});
