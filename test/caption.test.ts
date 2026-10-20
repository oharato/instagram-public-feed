import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptionBlock } from "../src/caption.ts";

test("public caption parsing keeps caption text without author/date or other comments", () => {
  assert.equal(
    parseCaptionBlock(
      '<span dir="auto"><a href="/fixture.one/"><span>fixture.one</span></a> <span><time datetime="2026-10-20T00:22:54Z">1日前</time></span>本文が直接のテキストノード<br>次の行 <a href="/tagged.user/">@tagged.user</a></span>',
      "fixture.one",
    ),
    "本文が直接のテキストノード\n次の行 @tagged.user",
  );
  const block = (account: string, body: string) =>
    `<span dir="auto"><a href="/${account}/">${account}</a><span><time datetime="2026-10-20T00:22:54Z">1日前</time></span><span>${body}</span></span>`;
  const metadata =
    '<span dir="auto"><a href="/fixture.one/p/Synthetic1/"><time datetime="2026-10-20T00:22:52Z">October 20</time></a></span>';
  assert.equal(
    parseCaptionBlock(
      metadata +
        block("fixture.one", "本文 &amp; quote<br>#test") +
        block("other.user", "別の人の長いコメントです"),
      "fixture.one",
    ),
    "本文 & quote\n#test",
  );
  assert.equal(parseCaptionBlock(block("other.user", "別の人のコメント"), "fixture.one"), null);
  assert.equal(
    parseCaptionBlock(
      block("fixture.one", "本文") + block("fixture.one", "投稿者の返信"),
      "fixture.one",
    ),
    null,
  );
  assert.equal(
    parseCaptionBlock(
      '<span dir="auto"><a href="/fixture.one/">fixture.one</a><span>時刻のない曖昧な本文</span></span>',
      "fixture.one",
    ),
    null,
  );
});
