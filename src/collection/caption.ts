import { parseFragment } from "parse5";

// Current public UI uses a caption block with an author link and a non-permalink
// time, instead of h1. Never mistake a different author's comment for the caption.
export function parseCaptionBlock(html: string, account: string): string | null {
  const root = parseFragment(html);
  const children = (node: any): any[] => node.childNodes ?? [];
  const attrs = (node: any): Record<string, string> =>
    Object.fromEntries((node.attrs ?? []).map((a: any) => [a.name, a.value]));
  function all(node: any): any[] {
    return [node, ...children(node).flatMap(all)];
  }
  function text(node: any, skipped: Set<any>): string {
    if (skipped.has(node)) return "";
    if (node.nodeName === "#text") return node.value;
    if (node.tagName === "br") return "\n";
    return children(node)
      .map((child) => text(child, skipped))
      .join("");
  }
  const isAuthor = (node: any) => {
    if (node.tagName !== "a") return false;
    try {
      const url = new URL(attrs(node).href, "https://www.instagram.com");
      return (
        ["www.instagram.com", "instagram.com"].includes(url.hostname) &&
        url.pathname === `/${account}/`
      );
    } catch {
      return false;
    }
  };
  const captions = new Set<string>();
  for (const node of all(root)) {
    if (node.tagName !== "span" || attrs(node).dir !== "auto") continue;
    const nodes = all(node);
    if (nodes.filter((n) => n.tagName === "time").length !== 1 || !nodes.some(isAuthor)) continue;
    // Timestamp links are official post metadata, not caption blocks.
    if (nodes.some((n) => n.tagName === "a" && all(n).some((c) => c.tagName === "time"))) continue;
    const author = nodes.find(isAuthor);
    const time = nodes.find((n) => n.tagName === "time");
    const body = text(node, new Set([author, time])).trim();
    if (body) captions.add(body);
  }
  return captions.size === 1 ? [...captions][0] : null;
}
