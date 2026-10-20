export function postId(href: string, account = "ningyocho.news"): string | null {
  try {
    const u = new URL(href, "https://www.instagram.com");
    if (u.hostname !== "www.instagram.com" && u.hostname !== "instagram.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 3 && parts[0] === account) parts.shift();
    return parts.length === 2 && /^(p|reel)$/.test(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1])
      ? parts[1]
      : null;
  } catch {
    return null;
  }
}
export function selectTimestamp(
  candidates: { href: string; datetime: string | null }[],
  account: string,
  shortcode: string,
) {
  const exact = candidates.filter((t) => postId(t.href, account) === shortcode);
  if (exact.length !== 1 || !exact[0].datetime || !Number.isFinite(Date.parse(exact[0].datetime)))
    throw new Error("DOM_UNSUPPORTED: ambiguous or invalid target permalink timestamp");
  return exact[0].datetime;
}
