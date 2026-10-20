import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { commit } from "../src/posts/storage.ts";
import { scrape } from "../src/collection/scrape.ts";

test("browser list import skips stored posts without visiting profile or replacing the input snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-browser-list-"));
  let closed = false;
  try {
    await commit(
      root,
      {
        account: "fixture.one",
        shortcode: "Synthetic1",
        source: "browser",
        text: "caption",
        carouselComplete: true,
        url: "https://www.instagram.com/p/Synthetic1/",
        imageUrls: ["https://example.invalid/image"],
      },
      async () => new Uint8Array([255, 216, 255, 224]),
    );
    await writeFile(join(root, "post-links.json"), "original snapshot");
    // No navigation or locator API is available: any attempt to rediscover a profile fails this test.
    const browser = {
      newContext: async () => ({
        newPage: async () => ({ on() {} }),
        close: async () => {
          closed = true;
        },
      }),
    } as unknown as Browser;
    const report: any = { saved: [], skipped: [] };
    await scrape(browser, "fixture.one", root, 1, report, false, [
      "https://www.instagram.com/p/Synthetic1/",
    ]);
    assert.deepEqual(report.skipped, ["Synthetic1"]);
    assert.equal(report.selection, "explicit_saved_list_order");
    assert.equal(await readFile(join(root, "post-links.json"), "utf8"), "original snapshot");
    assert.equal(closed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
