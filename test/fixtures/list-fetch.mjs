// Preloaded only in isolated CLI test subprocesses; never connects to a network.
import { appendFile } from "node:fs/promises";
globalThis.fetch = async (url) => {
  url = String(url);
  await appendFile(process.env.IG_LIST_TEST_LOG, url + "\n");
  const post = url.match(
    /^https:\/\/www\.instagram\.com\/(?:(fixture\.(?:one|two))\/)?(?:p|reel)\/Synthetic\d+\/$/,
  );
  if (post) {
    if (process.env.IG_LIST_TEST_DENIED === "1") return new Response("restricted", { status: 429 });
    return new Response(
      `<meta property="og:description" content="12 likes, 1 comments - ${post[1] ?? "fixture.one"} on October 20, 2026: &quot;Synthetic caption &amp; details&quot;">` +
        '<meta property="og:image" content="https://test.cdninstagram.com/synthetic.jpg">',
    );
  }
  if (url === "https://test.cdninstagram.com/synthetic.jpg") {
    return new Response(new Uint8Array([255, 216, 255, 224, 1, 2, 3]), {
      headers: { "content-type": "image/jpeg" },
    });
  }
  throw new Error("Unexpected network request: " + url);
};
