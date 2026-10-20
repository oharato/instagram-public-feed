import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { galleryScriptHash } from "./client.ts";

export function createPreviewServer(root: string) {
  // Only the generated HTML is served. Never expose config, reports or the repository.
  return createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (!["/", "/index.html", "/gallery.html"].includes(path)) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const html = await readFile(join(root, "gallery.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": html.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src '${galleryScriptHash}'; base-uri 'none'; frame-ancestors 'none'`,
      });
      response.end(request.method === "HEAD" ? undefined : html);
    } catch {
      response
        .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        .end("先に pnpm html を実行してください。");
    }
  });
}

export function previewUrls(host: string, port: number) {
  if (host !== "0.0.0.0") return [`http://${host.includes(":") ? `[${host}]` : host}:${port}/`];
  const addresses = Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address),
  );
  return [
    `http://localhost:${port}/`,
    ...new Set(addresses.map((address) => `http://${address}:${port}/`)),
  ];
}
