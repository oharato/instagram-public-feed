import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGallery } from "../src/gallery/render.ts";
import { createPreviewServer, previewUrls } from "../src/gallery/preview.ts";
import { galleryScript, galleryScriptHash } from "../src/gallery/client.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

test("gallery embeds local images, groups accounts, escapes captions and keeps previous output on invalid input", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-gallery-"));
  const data = join(root, "data");
  try {
    await mkdir(join(data, "fixture.one", "Synthetic1", "images"), { recursive: true });
    await writeFile(
      join(data, "fixture.one", "Synthetic1", "images", "01.jpg"),
      new Uint8Array([255, 216, 255, 224]),
    );
    const post = {
      account: "fixture.one",
      shortcode: "Synthetic1",
      url: "https://www.instagram.com/p/Synthetic1/",
      text: '本文 <script>alert("unsafe")</script> & quote\n改行',
      metadataDate: "October 20, 2026",
      status: "preview_only",
      images: [{ file: "images/01.jpg" }],
    };
    const snapshot = {
      accounts: ["fixture.one", "fixture.two"],
      posts: [
        post,
        {
          ...post,
          account: "fixture.two",
          shortcode: "Synthetic2",
          url: "https://www.instagram.com/p/Synthetic2/",
          text: null,
          rawDescription: '<img onerror="unsafe">',
          images: [],
        },
      ],
    };
    const input = join(data, "posts.json");
    await writeFile(input, JSON.stringify(snapshot));
    let result = await buildGallery(data);
    assert.equal(result.postCount, 2);
    assert.equal(result.accountCount, 2);
    assert.equal(result.imageCount, 1);
    let html = await readFile(result.file, "utf8");
    assert.ok(html.includes("data:image/jpeg;base64,/9j/4A=="));
    assert.ok(html.includes('id="account-fixture.one"'));
    assert.ok(html.includes('id="account-fixture.two"'));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&lt;img onerror="));
    assert.ok(html.includes("プレビュー"));
    assert.ok(html.includes("本文未取得"));
    assert.equal(html.split("<script>").length - 1, 1);
    assert.ok(html.includes(`<script>${galleryScript}</script>`));
    assert.ok(!html.includes('src="https://'));
    await writeFile(
      input,
      JSON.stringify({
        ...snapshot,
        posts: [
          { ...post, metadataDate: "September 25, 2026" },
          { ...snapshot.posts[1], publishedAt: "2026-10-20T00:22:52Z" },
        ],
      }),
    );
    await buildGallery(data);
    html = await readFile(result.file, "utf8");
    assert.ok(
      html.indexOf('data-shortcode="Synthetic2"') < html.indexOf('data-shortcode="Synthetic1"'),
    );

    // A broken image does not discard readable captions, and outside symlinks are not embedded.
    await rm(join(data, "fixture.one", "Synthetic1", "images", "01.jpg"));
    const outside = join(root, "outside.jpg");
    await writeFile(outside, new Uint8Array([255, 216, 255, 224, 99]));
    await symlink(outside, join(data, "fixture.one", "Synthetic1", "images", "01.jpg"));
    result = await buildGallery(data);
    assert.equal(result.imageCount, 0);
    assert.equal(result.warnings.length, 1);
    html = await readFile(result.file, "utf8");
    assert.ok(html.includes("画像未取得"));
    const prior = html;
    await writeFile(
      input,
      JSON.stringify({
        ...snapshot,
        posts: [{ ...post, images: [{ file: "../../config.json" }] }],
      }),
    );
    await assert.rejects(buildGallery(data), /Invalid stored image path/);
    assert.equal(await readFile(result.file, "utf8"), prior);
    await writeFile(
      input,
      JSON.stringify({ ...snapshot, posts: [{ ...post, url: "javascript:alert(1)" }] }),
    );
    await assert.rejects(buildGallery(data), /Invalid stored post URL/);
    await writeFile(input, JSON.stringify({ accounts: ["fixture.one"], posts: [] }));
    result = await buildGallery(data);
    assert.ok((await readFile(result.file, "utf8")).includes("保存された投稿はありません"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview serves only generated HTML, supports HEAD, and never exposes data or config", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-preview-"));
  const server = createPreviewServer(root);
  const request = (url: string, method = "GET") =>
    new Promise<{ status: number; headers: Record<string, string | number>; body: string }>(
      (resolve) => {
        let status = 200,
          headers: Record<string, string | number> = {};
        const response = {
          writeHead(code: number, values: Record<string, string | number> = {}) {
            status = code;
            headers = values;
            return this;
          },
          end(body?: Buffer | string) {
            resolve({ status, headers, body: body?.toString() ?? "" });
          },
        };
        server.emit(
          "request",
          { url, method } as IncomingMessage,
          response as unknown as ServerResponse,
        );
      },
    );
  try {
    assert.equal((await request("/")).status, 404);
    await writeFile(join(root, "gallery.html"), "<html>gallery</html>");
    await writeFile(join(root, "config.json"), "private");
    for (const url of ["/", "/index.html", "/gallery.html?refresh=1"]) {
      const response = await request(url);
      assert.equal(response.status, 200);
      assert.equal(response.body, "<html>gallery</html>");
      assert.equal(response.headers["Cache-Control"], "no-store");
      assert.ok(String(response.headers["Content-Security-Policy"]).includes("default-src 'none'"));
      assert.ok(
        String(response.headers["Content-Security-Policy"]).includes(
          `script-src '${galleryScriptHash}'`,
        ),
      );
    }
    const head = await request("/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal((await request("/", "POST")).status, 405);
    for (const path of [
      "/config.json",
      "/posts.json",
      "/.git/config",
      "/../config.json",
      "/%2e%2e/config.json",
      "//config.json",
      "/images/01.jpg",
    ])
      assert.equal((await request(path)).status, 404);
    await writeFile(join(root, "gallery.html"), "<html>updated</html>");
    assert.equal((await request("/")).body, "<html>updated</html>");
    assert.deepEqual(previewUrls("127.0.0.1", 3000), ["http://127.0.0.1:3000/"]);
    assert.deepEqual(previewUrls("::1", 3000), ["http://[::1]:3000/"]);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
