import { readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicFile, recover } from "./storage.ts";
import { comparePostsNewest } from "./ordering.ts";
export async function aggregate(root: string, accounts: string[]) {
  const posts = [];
  for (const account of accounts) {
    const dir = join(root, account);
    await recover(dir);
    const entries = await readdir(dir, { withFileTypes: true }).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.match(/^[A-Za-z0-9_-]+$/)) continue;
      const p = JSON.parse(await readFile(join(dir, entry.name, "post.json"), "utf8"));
      if (p.account !== account || p.shortcode !== entry.name)
        throw new Error("Stored post identity mismatch");
      posts.push({ ...p, path: `${account}/${entry.name}/post.json` });
    }
  }
  posts.sort(comparePostsNewest);
  const tmp = join(root, "posts.json.next");
  await rm(tmp, { force: true });
  await atomicFile(tmp, JSON.stringify({ accounts, posts }, null, 2) + "\n");
  await rename(tmp, join(root, "posts.json"));
}
