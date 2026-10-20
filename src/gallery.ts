import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { atomicFile, imageExtension, postId } from "./core.ts";
import { parseConfig } from "./runner.ts";
import { comparePostsNewest } from "./post-order.ts";
import { galleryScript } from "./gallery-client.ts";

interface GalleryPost {
  account: string;
  shortcode: string;
  url: string;
  text: string | null;
  rawDescription?: string;
  publishedAt?: string | null;
  metadataDate?: string | null;
  status: string;
  images: { file: string }[];
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function postUrl(post: GalleryPost): string {
  const url = new URL(post.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["https://www.instagram.com", "https://instagram.com"].includes(url.origin) ||
    postId(post.url, post.account) !== post.shortcode
  )
    throw new Error("Invalid stored post URL");
  return url.origin + url.pathname;
}

const styles = `
:root{color-scheme:light;font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;color:#20302b;background:#f3f5f0}
*{box-sizing:border-box}body{margin:0}a{color:#216249;text-underline-offset:3px}header{background:#183f32;color:#fff;padding:44px max(24px,calc((100vw - 1240px)/2));border-bottom:5px solid #d7a96d}
header p{color:#d7e4dc;font-size:14px;line-height:1.8}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:6px 0 16px}header small{letter-spacing:.16em}nav{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}nav a{color:#fff;text-decoration:none;border:1px solid #709283;border-radius:24px;padding:8px 14px;font-size:14px}
main{max-width:1288px;margin:auto;padding:12px 24px 56px}section{scroll-margin-top:24px;margin-top:40px}h2{font-size:22px;display:flex;align-items:center;gap:12px}h2 span{font-size:13px;font-weight:400;color:#64776c}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:24px;align-items:start}
article{background:#fff;border:1px solid #dce3d9;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px #173d2d06}.images{overflow:hidden;background:#e9ede5}.images img{display:block;width:100%;aspect-ratio:1;object-fit:contain}.content{padding:22px}.meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:#65746b}.badge{background:#f5eddf;color:#725322;border-radius:5px;padding:4px 7px}.caption{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:14px;margin:18px 0}.post-link{display:block;border-top:1px solid #e7ece3;padding-top:16px;font-size:13px}.empty{padding:32px;text-align:center;color:#6a796f}.images .empty{width:100%;aspect-ratio:1;display:grid;place-items:center}details{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.notice{font-size:13px;line-height:1.8;color:#66786b}footer{font-size:12px;text-align:center;padding:32px;color:#6a796f}
@media(max-width:480px){header{padding:30px 20px}main{padding:8px 16px 32px}.grid{gap:18px}.content{padding:18px}}
.images img[hidden]{display:none}.carousel-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #e7ece3}.carousel-controls button{font:inherit;font-size:13px;min-height:40px;padding:8px 14px;border:1px solid #c8d5c9;border-radius:8px;background:#fff;color:#216249;cursor:pointer}.carousel-controls button:hover:not(:disabled){background:#edf3eb}.carousel-controls button:disabled{opacity:.35;cursor:default}.carousel-controls button:focus-visible{outline:3px solid #d7a96d;outline-offset:2px}.carousel-controls output{font-size:13px;font-variant-numeric:tabular-nums;color:#65746b}
`;

export async function buildGallery(root: string) {
  let snapshot: { accounts: string[]; posts: GalleryPost[] };
  try {
    snapshot = JSON.parse(await readFile(join(root, "posts.json"), "utf8"));
  } catch (error) {
    throw new Error(
      `posts.json を読み込めません。先に pnpm posts を実行してください: ${String(error)}`,
    );
  }
  const accounts = parseConfig({ accounts: snapshot.accounts }).accounts;
  if (!Array.isArray(snapshot.posts)) throw new Error("posts.json must contain a posts array");
  const base = await realpath(root);
  const warnings: string[] = [];
  let imageCount = 0;
  const groups = new Map(accounts.map((account) => [account, [] as string[]]));
  const cards: string[] = [];
  for (const post of [...snapshot.posts].sort(comparePostsNewest)) {
    if (
      !groups.has(post.account) ||
      !/^[A-Za-z0-9_-]+$/.test(post.shortcode) ||
      !(post.text === null || typeof post.text === "string") ||
      !Array.isArray(post.images)
    )
      throw new Error("Invalid stored post in posts.json");
    const url = postUrl(post);
    const images: string[] = [];
    for (const [index, image] of post.images.entries()) {
      if (typeof image?.file !== "string" || !/^images\/\d+\.(jpg|jpeg|png|webp)$/.test(image.file))
        throw new Error("Invalid stored image path");
      try {
        const path = await realpath(join(base, post.account, post.shortcode, image.file));
        const within = relative(base, path);
        if (within === ".." || within.startsWith("../") || isAbsolute(within))
          throw new Error("Image is outside the data directory");
        const bytes = await readFile(path);
        const ext = imageExtension(bytes);
        images.push(
          `<img src="data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytes.toString("base64")}" alt="${escape(post.account)} の投稿画像 ${index + 1}" loading="lazy" decoding="async"${images.length ? " hidden" : ""}>`,
        );
        imageCount++;
      } catch {
        warnings.push(`${post.account}/${post.shortcode}/${image.file}: 画像を読み込めません`);
      }
    }
    const date =
      post.publishedAt && Number.isFinite(Date.parse(post.publishedAt))
        ? new Date(post.publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
        : post.metadataDate
          ? `${post.metadataDate}（参考）`
          : "投稿日時不明";
    const caption =
      post.text === null
        ? `<p class="caption">本文未取得</p>${typeof post.rawDescription === "string" ? `<details><summary>取得できた説明を表示</summary>${escape(post.rawDescription)}</details>` : ""}`
        : `<p class="caption">${escape(post.text)}</p>`;
    const badge =
      post.status === "complete"
        ? "保存済み"
        : post.status === "preview_only"
          ? "プレビュー"
          : "一部取得";
    const group = groups.get(post.account)!;
    const controls =
      images.length > 1
        ? `<div class="carousel-controls" role="group" aria-label="${post.account} の投稿画像の切り替え"><button type="button" data-previous disabled aria-label="前の画像">← 前へ</button><output aria-live="polite" aria-atomic="true">1 / ${images.length}</output><button type="button" data-next aria-label="次の画像">次へ →</button></div>`
        : "";
    const card = `<article ${group.length === 0 ? `id="account-${post.account}"` : ""} data-account="${post.account}" data-shortcode="${post.shortcode}"><div class="media"><div class="images">${images.join("") || '<p class="empty">画像未取得</p>'}</div>${controls}</div><div class="content"><strong>@${escape(post.account)}</strong><div class="meta"><span>${escape(date)}</span><span class="badge">${badge}</span><span>画像 ${images.length}枚</span></div>${caption}<a class="post-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Instagram で投稿を見る ↗</a></div></article>`;
    group.push(card);
    cards.push(card);
  }
  const generatedAt = new Date().toISOString();
  const nav = accounts
    .map(
      (account) =>
        `<a href="#account-${account}">@${escape(account)} · ${groups.get(account)!.length}</a>`,
    )
    .join("");
  const sections =
    `<section><h2>投稿一覧 <span>新しい順</span></h2><div class="grid">${cards.join("") || '<p class="empty">保存された投稿はありません</p>'}</div></section>` +
    accounts
      .filter((account) => !groups.get(account)!.length)
      .map(
        (account) =>
          `<section id="account-${account}"><h2>@${escape(account)} <span>${groups.get(account)!.length}件</span></h2><div class="grid">${groups.get(account)!.join("") || '<p class="empty">保存された投稿はありません</p>'}</div></section>`,
      )
      .join("");
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram 投稿一覧</title><style>${styles}</style></head>
<body><header><small>INSTAGRAM PUBLIC FEED</small><h1>保存した投稿を、ひとつに。</h1><p>${accounts.length}アカウント · ${snapshot.posts.length}件の投稿 · ${imageCount}枚の画像<br>更新 ${escape(new Date(generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))} JST</p><nav aria-label="アカウント一覧">${nav}</nav></header><main><p class="notice">保存済みデータの一覧です。「プレビュー」は本文の省略や画像の欠けがある場合があります。複数画像は「前へ」「次へ」ボタンで切り替えられます。</p>${sections}</main><footer>画像を含め、この HTML だけで閲覧できます。</footer><script>${galleryScript}</script></body></html>`;
  const file = join(root, "gallery.html");
  await atomicFile(file, html);
  return {
    status: "complete",
    file,
    generatedAt,
    accountCount: accounts.length,
    postCount: snapshot.posts.length,
    imageCount,
    warnings,
  };
}
