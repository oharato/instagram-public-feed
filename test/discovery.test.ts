import test from "node:test";
import assert from "node:assert/strict";
import { discoverProfileLinks } from "../src/discovery.ts";

test("discovery unions virtualized links, clicks more once, and stops before reading a login wall", async () => {
  let stage = 0,
    scrolls = 0,
    more = 0,
    reads = 0;
  const result = await discoverProfileLinks("fixture.one", 10, {
    guard: async () => {},
    links: async () => {
      reads++;
      return stage === 0 ? ["/p/First/"] : stage === 1 ? ["/p/Second/"] : ["/p/Hidden/"];
    },
    scroll: async () => {
      scrolls++;
      if (more) stage = 2;
    },
    more: async () => {
      more++;
      stage = 1;
      return true;
    },
    loginDialog: async () => stage === 2,
  });
  assert.deepEqual(result.ids, ["First", "Second"]);
  assert.equal(result.stopReason, "login_wall");
  assert.equal(more, 1);
  assert.equal(scrolls, 4);
  assert.equal(reads, 5);
});

test("discovery is bounded, defaults to initial links, and halts on access restrictions", async () => {
  let scrolls = 0;
  const ui = {
    guard: async () => {},
    links: async () => ["/p/First/"],
    scroll: async () => {
      scrolls++;
    },
    more: async () => false,
    loginDialog: async () => false,
  };
  assert.equal((await discoverProfileLinks("fixture.one", 0, ui)).stopReason, "initial_only");
  assert.equal(scrolls, 0);
  assert.equal((await discoverProfileLinks("fixture.one", 20, ui)).stopReason, "no_new_links");
  assert.equal(scrolls, 3);
  await assert.rejects(
    discoverProfileLinks("fixture.one", 2, {
      ...ui,
      guard: async () => {
        throw new Error("HTTP 429");
      },
    }),
    /HTTP 429/,
  );
  assert.equal(scrolls, 3);
});
