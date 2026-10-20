import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readFile, stat, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
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
export function latest<T extends { shortcode: string; publishedAt: string }>(
  posts: T[],
  limit: number,
): T[] {
  return [...new Map(posts.map((p) => [p.shortcode, p])).values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit);
}
export function imageExtension(b: Uint8Array): string {
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (Buffer.from(b.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "png";
  if (
    Buffer.from(b.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(b.subarray(8, 12)).toString() === "WEBP"
  )
    return "webp";
  throw new Error("Unsupported or invalid image bytes");
}
export async function saved(root: string, id: string, mode = "browser") {
  try {
    const p = JSON.parse(await readFile(join(root, id, "post.json"), "utf8"));
    if (p.source === "http" && typeof p.text !== "string") return false;
    if (
      !(p.status === "complete" || (mode === "http" && p.status === "preview_only")) ||
      p.shortcode !== id ||
      !p.images?.length
    )
      return false;
    for (const im of p.images) {
      const bytes = await readFile(join(root, id, im.file));
      if (
        bytes.length !== im.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== im.sha256
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export async function atomicFile(path: string, bytes: Uint8Array | string) {
  const tmp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function commit(
  root: string,
  post: any,
  fetchImage: (url: string) => Promise<Uint8Array>,
) {
  await mkdir(root, { recursive: true });
  const stage = join(root, `.${post.shortcode}.stage`),
    dest = join(root, post.shortcode);
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(stage, "images"), { recursive: true });
  const images: { file: string; bytes: number; sourceUrl: string; sha256: string }[] = [];
  try {
    for (const url of post.imageUrls) {
      const b = await fetchImage(url);
      const ext = imageExtension(b);
      const file = `images/${String(images.length + 1).padStart(2, "0")}.${ext}`;
      await atomicFile(join(stage, file), b);
      images.push({
        file,
        bytes: b.length,
        sourceUrl: url,
        sha256: createHash("sha256").update(b).digest("hex"),
      });
    }
    if (!images.length) throw new Error("No downloadable images");
    const { imageUrls: _imageUrls, ...metadata } = post;
    const result = {
      ...metadata,
      status:
        post.source === "http"
          ? typeof post.text === "string"
            ? "preview_only"
            : "partial"
          : post.carouselComplete
            ? "complete"
            : "partial",
      images,
      imageCount: images.length,
    };
    await atomicFile(join(stage, "post.json"), JSON.stringify(result, null, 2) + "\n");
    // Preserve a prior partial result until replacement has downloaded successfully.
    const backup = dest + ".previous";
    await rm(backup, { recursive: true, force: true });
    try {
      await rename(dest, backup);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    await rename(stage, dest);
    await rm(backup, { recursive: true, force: true });
    return result;
  } catch (e) {
    await atomicFile(
      join(stage, "failure.json"),
      JSON.stringify({ error: String(e), downloadedImages: images.length }),
    );
    throw e;
  }
}

export async function recover(root: string) {
  const entries = await readdir(root).catch((e: any) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  for (const name of entries)
    if (/^[A-Za-z0-9_-]+\.previous$/.test(name)) {
      const original = join(root, name.slice(0, -9));
      try {
        await stat(original);
      } catch (e: any) {
        if (e.code === "ENOENT") await rename(join(root, name), original);
        else throw e;
      }
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
