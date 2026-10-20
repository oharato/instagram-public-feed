import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicFile, postId } from "./core.ts";

export function parsePostLinks(value: unknown, account: string): string[] {
  const input = value as any;
  if (!input || input.account !== account || !Array.isArray(input.posts) || !input.posts.length) {
    throw new Error(
      "Post link list must contain the configured account and a nonempty posts array",
    );
  }
  const urls = new Map<string, string>();
  for (const post of input.posts) {
    if (typeof post?.url !== "string") throw new Error("Post link list contains a missing URL");
    let url: URL;
    try {
      url = new URL(post.url);
    } catch {
      throw new Error("Post link list contains an invalid URL");
    }
    const id = postId(post.url, account);
    if (
      url.protocol !== "https:" ||
      !["https://www.instagram.com", "https://instagram.com"].includes(url.origin) ||
      url.username ||
      url.password ||
      !id ||
      (post.shortcode !== undefined && post.shortcode !== id)
    ) {
      throw new Error(
        "Post link list contains an invalid Instagram post URL or mismatched shortcode",
      );
    }
    if (!urls.has(id)) urls.set(id, `https://www.instagram.com${url.pathname}`);
  }
  return [...urls.values()];
}

export async function savePostLinks(root: string, account: string, shortcodes: string[]) {
  const result = {
    account,
    source: "profile_public_dom",
    selection: "visible_profile_order_not_verified_latest",
    fetchedAt: new Date().toISOString(),
    posts: shortcodes.map((shortcode) => ({
      shortcode,
      url: `https://www.instagram.com/p/${shortcode}/`,
    })),
  };
  await mkdir(root, { recursive: true });
  const file = join(root, "post-links.json");
  await atomicFile(file, JSON.stringify(result, null, 2) + "\n");
  return file;
}
