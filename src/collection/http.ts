import { parse } from "parse5";
import { postId } from "../posts/identity.ts";
import { commit, saved } from "../posts/storage.ts";
export function parsePublicHtml(html: string) {
  const meta: Record<string, string> = {};
  const links: string[] = [];
  const texts: string[] = [];
  function walk(n: any, hidden = false) {
    const attrs = Object.fromEntries((n.attrs ?? []).map((a: any) => [a.name, a.value]));
    if (n.tagName === "meta") {
      const key = attrs.property || attrs.name;
      if (key && attrs.content) meta[key] = attrs.content;
    }
    if (n.tagName === "a" && attrs.href) links.push(attrs.href);
    const skip = hidden || ["script", "style"].includes(n.tagName);
    if (n.nodeName === "#text" && !skip) texts.push(n.value);
    for (const c of n.childNodes ?? []) walk(c, skip);
  }
  walk(parse(html));
  return { meta, links, visibleText: texts.join(" ") };
}
export function parseDescription(raw: string, expectedAccount: string) {
  // Anchored prefix + outer quotes, never split on quotes inside a caption.
  const match = raw.match(
    /^([\d,.KMB]+) likes?, ([\d,.KMB]+) comments? - ([A-Za-z0-9_.]+) on ([A-Za-z]+ \d{1,2}, \d{4}): "([\s\S]*)"\.?\s*$/,
  );
  if (!match || match[3].toLowerCase() !== expectedAccount.toLowerCase())
    return { text: null, metadataDate: null, captionStatus: "unrecognized" };
  return {
    text: match[5],
    metadataDate: match[4],
    captionStatus: "metadata_only_unverified_full_length",
  };
}
export async function publicGet(url: string) {
  const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(45000) });
  if (r.status >= 300 && r.status < 400)
    throw new Error(`Login/challenge or redirect: HTTP ${r.status}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${new URL(url).hostname}`);
  return r;
}
export async function imageGet(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname))
    throw new Error("Unexpected media host");
  const r = await publicGet(url);
  if (!r.headers.get("content-type")?.startsWith("image/")) throw new Error("Non-image response");
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > 30 * 1024 * 1024) throw new Error("Image exceeds 30 MiB");
  return b;
}
export async function getHtml(url: string) {
  const r = await publicGet(url);
  const html = await r.text();
  const parsed = parsePublicHtml(html);
  if (
    /captcha|access denied|too many requests|try again later|しばらくしてからもう一度/i.test(
      parsed.visibleText,
    )
  )
    throw new Error("Access restriction/CAPTCHA detected");
  return parsed;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 3000));
export async function httpAccount(
  account: string,
  root: string,
  limit: number,
  report: any,
  seedUrls: string[],
  extra: Record<string, unknown> = {},
) {
  let urls = seedUrls;
  if (!urls.length) {
    const profile = await getHtml(`https://www.instagram.com/${account}/`);
    const ids = [...new Set(profile.links.map((h) => postId(h, account)).filter(Boolean))];
    report.visibleShortcodes = ids;
    if (!ids.length)
      throw new Error(
        "HTTP_DISCOVERY_UNAVAILABLE: profile HTML has no public post links; provide known post URLs or opt in to --mode browser",
      );
    // Metadata dates cannot safely resolve newest order or pins; do not guess.
    throw new Error(
      "HTTP_ORDER_UNVERIFIED: profile links found but exact publication times unavailable; provide up to 3 selected known URLs or use --mode browser",
    );
  }
  if (urls.length > limit) throw new Error("Known URLs exceed --limit; choose up to 3 explicitly");
  report.selection = report.inputListFile
    ? "explicit_saved_list_order"
    : "explicit_known_urls_not_latest_discovery";
  for (const url of urls) {
    const shortcode = postId(url, account)!;
    if (await saved(root, shortcode, "http")) {
      report.skipped.push(shortcode);
      continue;
    }
    await pause();
    const { meta } = await getHtml(url);
    const rawDescription = meta["og:description"];
    const image = meta["og:image"];
    if (!rawDescription || !image)
      throw new Error("No public post Open Graph metadata; possible login wall or changed HTML");
    const caption = parseDescription(rawDescription, account);
    const result = await commit(
      root,
      {
        account,
        shortcode,
        url,
        source: "http",
        rawDescription,
        ...caption,
        publishedAt: null,
        publishedAtSource: null,
        metadataDateSource: "og:description (locale/date only, timezone unknown)",
        imageUrls: [image],
        imagesComplete: false,
        carouselComplete: false,
        carouselReason: "Open Graph preview only; remaining carousel images unavailable",
        fetchedAt: new Date().toISOString(),
        ...extra,
      },
      imageGet,
    );
    report.saved.push({
      shortcode,
      status: result.status,
      imageCount: result.imageCount,
      imagesComplete: false,
    });
    if (caption.text === null)
      throw new Error(
        `Caption metadata format unrecognized: ${shortcode}; rawDescription retained`,
      );
  }
}
