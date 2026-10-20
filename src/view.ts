import { access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildGallery } from "./gallery.ts";
import { createPreviewServer, previewUrls } from "./preview.ts";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (key: string, fallback: string) => {
    const index = args.indexOf(key);
    if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith("--")))
      throw new Error(`Missing ${key} value`);
    return index < 0 ? fallback : args[index + 1];
  };
  const root = resolve(option("--out", "data"));
  if (command === "html") {
    console.log(JSON.stringify(await buildGallery(root), null, 2));
    return;
  }
  if (command !== "preview") throw new Error("Use pnpm html or pnpm preview");
  await access(join(root, "gallery.html")).catch(() => {
    throw new Error("gallery.html がありません。先に pnpm html を実行してください。");
  });
  const port = Number(option("--port", "3000"));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("--port must be 0..65535");
  const host = option("--host", "0.0.0.0");
  const server = createPreviewServer(root);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot determine preview port");
  console.log(
    JSON.stringify(
      { status: "listening", host, port: address.port, urls: previewUrls(host, address.port) },
      null,
      2,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
}

main().catch((error) => {
  console.log(JSON.stringify({ status: "failed", error: String(error) }, null, 2));
  process.exitCode = 1;
});
