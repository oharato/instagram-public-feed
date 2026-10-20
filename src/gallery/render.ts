import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { atomicFile, imageExtension } from "../posts/storage.ts";
import { postId } from "../posts/identity.ts";
import { parseConfig } from "../app/config.ts";
import { comparePostsNewest } from "../posts/ordering.ts";
import { galleryScript } from "./client.ts";

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

const styles = await readFile(new URL("./gallery.css", import.meta.url), "utf8");
const number = new Intl.NumberFormat("ja-JP");
const dayFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});
const shortDayFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});
const updatedFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});
const icons = {
  mark: '<svg class="brand-mark" width="28" height="30" viewBox="0 0 28 30" fill="none" aria-hidden="true"><path d="M5 12V5h18v20H5v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M1 13h15M1 17h11M10 8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="20" r="2" fill="currentColor"/></svg>',
  search:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  left: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  right:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  external:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 4h6v6m-9 3 9-9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>',
};

function excerpt(value: string, length = 85): string {
  const graphemes = [
    ...new Intl.Segmenter("ja-JP", { granularity: "grapheme" }).segment(value.trim()),
  ].map((part) => part.segment);
  return graphemes.length > length ? graphemes.slice(0, length).join("") + "…" : graphemes.join("");
}

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
        const firstFrame = images.length === 0;
        const imageAlt = `${post.account}：${excerpt(post.text || "投稿画像", 45)}（${number.format(index + 1)}枚目）`;
        images.push(
          `<img src="data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytes.toString("base64")}" alt="${escape(imageAlt)}" width="900" height="900" loading="${firstFrame && cards.length < 3 ? "eager" : "lazy"}"${firstFrame && cards.length === 0 ? ' fetchpriority="high"' : ""} decoding="async"${firstFrame ? "" : " hidden"}>`,
        );
        imageCount++;
      } catch {
        warnings.push(`${post.account}/${post.shortcode}/${image.file}: 画像を読み込めません`);
      }
    }
    const published =
      post.publishedAt && Number.isFinite(Date.parse(post.publishedAt))
        ? new Date(post.publishedAt)
        : null;
    const metadata = Date.parse(post.metadataDate || "");
    const date = published
      ? `<time class="post-date" datetime="${published.toISOString()}" title="${escape(updatedFormat.format(published))} JST">${escape(dayFormat.format(published))}</time>`
      : `<span class="post-date" title="${escape(post.metadataDate || "投稿日時不明")}">${Number.isFinite(metadata) ? escape(dayFormat.format(new Date(metadata))) + "（参考）" : "日付不明"}</span>`;
    const caption =
      post.text === null
        ? `<p class="caption">本文未取得</p>${typeof post.rawDescription === "string" ? `<details class="raw-description"><summary>取得できた説明を表示</summary>${escape(post.rawDescription)}</details>` : ""}`
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
        ? `<div class="carousel-controls" role="group" aria-label="${post.account} の投稿画像の切り替え"><button type="button" data-previous disabled aria-label="前の画像">${icons.left}前へ</button><output aria-live="polite" aria-atomic="true">1 / ${number.format(images.length)}</output><button type="button" data-next aria-label="次の画像">次へ${icons.right}</button></div>`
        : "";
    const titleId = `title-${post.account}-${post.shortcode}`;
    const title = post.text?.trim() ? excerpt(post.text.replace(/\s+/g, " ")) : "本文未取得";
    const body = `<details class="caption-detail"><summary><span class="read-closed">本文を読む</span><span class="read-open">本文を閉じる</span>${icons.down}</summary>${caption}</details>`;
    const card = `<article ${group.length === 0 ? `id="account-${post.account}"` : ""} data-account="${post.account}" data-shortcode="${post.shortcode}" aria-labelledby="${titleId}"><div class="post-top"><div class="post-author"><span class="author-dot" aria-hidden="true"></span><span class="author-name" translate="no">@${escape(post.account)}</span></div>${date}</div><div class="media"><div class="images">${images.join("") || '<p class="empty">画像未取得</p>'}</div>${controls}</div><div class="content"><h3 id="${titleId}" class="post-title"><span>${escape(title)}</span></h3><div class="post-meta"><span>写真 ${number.format(images.length)}枚</span>${post.status === "complete" ? "" : `<span class="badge">${badge}</span>`}</div>${body}<a class="post-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-label="${post.account} の投稿をInstagramで見る（新しいタブ）"><span>Instagramで見る</span>${icons.external}</a></div></article>`;
    group.push(card);
    cards.push(card);
  }
  const generatedAt = new Date().toISOString();
  const accountButton = (account: string, label: string, count: number) =>
    `<button type="button" class="account-option" data-account-filter="${escape(account)}" aria-pressed="${account === ""}" aria-label="${escape(label)}の投稿を表示"><span class="account-name"${account ? ' translate="no"' : ""}>${escape(label)}</span><span class="account-count">${number.format(count)}</span></button>`;
  const filters =
    accountButton("", "すべて", cards.length) +
    accounts
      .map((account) => accountButton(account, `@${account}`, groups.get(account)!.length))
      .join("");
  const empty = `<div class="no-results" id="no-results"${cards.length ? " hidden" : ""}><h3>${cards.length ? "条件に合う投稿がありません" : "保存された投稿はありません"}</h3><p>${cards.length ? "別のキーワードで探すか、アカウントの絞り込みを変更してください。" : "投稿を保存すると、ここに表示されます。"}</p>${cards.length ? '<button type="button" class="reset-filters" data-reset-filters>すべての投稿を表示</button>' : ""}</div>`;
  const previewCount = snapshot.posts.filter((post) => post.status !== "complete").length;
  const previewNote = previewCount
    ? '<p class="preview-note">「プレビュー」「一部取得」の投稿は、本文や画像が省略されている場合があります。</p>'
    : "";
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f8fa"><meta name="description" content="保存したInstagramの投稿を、写真といっしょに新しい順に。"><title>街の便り | Instagram 投稿一覧</title><style>${styles}</style></head>
<body><a class="skip-link" href="#posts">投稿一覧へ移動</a><header id="top" class="masthead"><div class="shell masthead-inner"><a class="brand" href="#top">${icons.mark}<span>街の便り</span></a><div class="updated">最終更新<br><time datetime="${generatedAt}" title="${escape(updatedFormat.format(new Date(generatedAt)))} JST">${escape(shortDayFormat.format(new Date(generatedAt)))}</time></div></div></header>
<div class="shell intro"><h1>街の話題を、<br class="mobile-break">写真から。</h1><p>見かけたお店、週末の催し、日々の小さな発見。<br>保存した投稿を、写真といっしょに。</p></div>
<main class="shell workspace"><aside class="accounts" aria-label="アカウントで絞り込み"><h2>アカウント</h2><div class="account-options" role="group" aria-label="表示するアカウント">${filters}</div><p class="sidebar-note">${number.format(accounts.length)}アカウントの投稿を<br>新しい順にまとめています。</p></aside><section class="feed" aria-labelledby="posts"><form role="search"><label class="sr-only" for="post-search">投稿を検索</label><div class="search-field">${icons.search}<input id="post-search" name="q" type="search" placeholder="例：ランチ、イベント…" autocomplete="off" spellcheck="false"></div></form><div class="feed-heading"><h2 id="posts" tabindex="-1">投稿一覧<output id="result-count" aria-live="polite" aria-atomic="true">${number.format(cards.length)}件</output></h2><span class="sort-label">${icons.down}新しい順</span></div><div class="grid">${cards.join("")}</div>${empty}${previewNote}</section></main>
<footer class="page-footer"><div class="shell"><span>写真 ${number.format(imageCount)}枚、投稿 ${number.format(snapshot.posts.length)}件。</span><span>画像を含め、このHTMLだけで閲覧できます。</span></div></footer><script>${galleryScript}</script></body></html>`;
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
