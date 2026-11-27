import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { getQuery } from "h3";
import { useNameMatches } from "../../app/composables/nameMatches";

vi.mock("vuefire", () => ({ useCurrentUser: () => ref(null) }));

/** What the two endpoints were asked, and answer. */
let asked: { path: string; query: Record<string, unknown> }[] = [];
registerEndpoint("/api/search", (event) => {
  asked.push({ path: "/api/search", query: getQuery(event) });
  return [
    { id: "p1", name: "Jan Kowalski", type: "person" },
    { id: "c1", name: "Kowalski i Syn", type: "place" },
  ];
});
registerEndpoint("/api/search/pages", (event) => {
  asked.push({ path: "/api/search/pages", query: getQuery(event) });
  return [{ id: "a1", name: "Kowalski odwołany", url: "https://x.pl/a" }];
});

/** Past the 300 ms debounce. Real time: vitest's clock does not drive it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 450));

describe("useNameMatches", () => {
  beforeEach(() => {
    asked = [];
  });

  it("asks the search for a person or place and keeps the type asked for", async () => {
    const name = ref("Kowalski");
    const { entities } = useNameMatches("person", name);
    await settled();
    expect(asked.map((a) => a.path)).toEqual(["/api/search"]);
    expect(asked[0]!.query.q).toBe("Kowalski");
    expect(entities.value).toEqual({ p1: { name: "Jan Kowalski" } });
  });

  it("asks for articles by headline and link", async () => {
    const { entities } = useNameMatches("article", ref("Kowalski"));
    await settled();
    expect(asked).toEqual([
      {
        path: "/api/search/pages",
        query: { type: "article", q: "Kowalski", url: "Kowalski" },
      },
    ]);
    expect(entities.value).toEqual({
      a1: { name: "Kowalski odwołany", sourceURL: "https://x.pl/a" },
    });
  });

  it("asks nothing for fewer than two letters", async () => {
    const { entities } = useNameMatches("person", ref("K"));
    await settled();
    expect(asked).toEqual([]);
    expect(entities.value).toEqual({});
  });
});
