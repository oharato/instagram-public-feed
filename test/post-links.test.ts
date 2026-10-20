import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePostLinks, parsePostLinks } from "../src/posts/links.ts";

test("list import validates account and every URL before deduplicating", () => {
  const input = {
    account: "fixture.one",
    posts: [
      {
        shortcode: "Synthetic1",
        url: "https://www.instagram.com/p/Synthetic1/?token=discard#fragment",
      },
      { url: "https://instagram.com/fixture.one/p/Synthetic1/" },
      { shortcode: "Synthetic2", url: "https://www.instagram.com/reel/Synthetic2/" },
    ],
  };
  assert.deepEqual(parsePostLinks(input, "fixture.one"), [
    "https://www.instagram.com/p/Synthetic1/",
    "https://www.instagram.com/reel/Synthetic2/",
  ]);
  for (const url of [
    "http://www.instagram.com/p/Synthetic1/",
    "https://evil.invalid/p/Synthetic1/",
    "https://www.instagram.com.evil.invalid/p/Synthetic1/",
    "https://user:pass@www.instagram.com/p/Synthetic1/",
    "https://www.instagram.com:444/p/Synthetic1/",
    "https://www.instagram.com/other/p/Synthetic1/",
    "https://www.instagram.com/accounts/login/",
    "/p/Synthetic1/",
    "bad",
  ]) {
    assert.throws(() => parsePostLinks({ ...input, posts: [{ url }] }, "fixture.one"));
  }
  assert.throws(() => parsePostLinks(input, "fixture.two"));
  assert.throws(() => parsePostLinks({ ...input, posts: [] }, "fixture.one"));
  assert.throws(() =>
    parsePostLinks(
      { ...input, posts: [{ url: input.posts[0].url, shortcode: "Other" }] },
      "fixture.one",
    ),
  );
  assert.throws(() => parsePostLinks({ ...input, posts: [{}] }, "fixture.one"));
  assert.throws(() => parsePostLinks(null, "fixture.one"));
});

test("list output is independent of media storage and replaces the previous snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-links-"));
  try {
    await writeFile(join(root, "post.json"), "existing media");
    const file = await savePostLinks(root, "fixture.one", ["Synthetic1", "Synthetic2"]);
    const result = JSON.parse(await readFile(file, "utf8"));
    assert.equal(result.account, "fixture.one");
    assert.equal(result.selection, "visible_profile_order_not_verified_latest");
    assert.deepEqual(
      result.posts.map((p: any) => p.url),
      ["https://www.instagram.com/p/Synthetic1/", "https://www.instagram.com/p/Synthetic2/"],
    );
    await savePostLinks(root, "fixture.one", ["Synthetic3"]);
    assert.equal(JSON.parse(await readFile(file, "utf8")).posts.length, 1);
    assert.equal(await readFile(join(root, "post.json"), "utf8"), "existing media");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
