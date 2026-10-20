import test from "node:test";
import assert from "node:assert/strict";
import { comparePostsNewest } from "../src/posts/ordering.ts";

test("newest order uses publication time then metadata date, leaves unknown dates last", () => {
  const posts = [
    { id: "unknown", publishedAt: null, metadataDate: null },
    { id: "older", metadataDate: "September 25, 2026" },
    { id: "latest", publishedAt: "2026-10-20T00:22:52Z", metadataDate: "October 19, 2026" },
    { id: "middle", metadataDate: "October 10, 2026" },
    { id: "invalid", publishedAt: "invalid", metadataDate: "February 30, 2026" },
  ];
  assert.deepEqual(
    posts.sort(comparePostsNewest).map((p) => p.id),
    ["latest", "middle", "older", "unknown", "invalid"],
  );
  assert.equal(
    comparePostsNewest({ metadataDate: "October 10, 2026" }, { metadataDate: "October 10, 2026" }),
    0,
  );
});
