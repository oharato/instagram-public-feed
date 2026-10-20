import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { findBrowser } from "../src/collection/browser.ts";

test("browser discovery honors explicit path and environment before searching executable PATH entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-browser-path-"));
  try {
    const first = join(root, "first"),
      second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "chromium"), "not executable", { mode: 0o600 });
    const chrome = join(second, "google-chrome");
    await writeFile(chrome, "#!/bin/sh\n", { mode: 0o700 });
    const env = { PATH: [first, second].join(delimiter), CHROMIUM_PATH: "/custom/chromium" };
    assert.equal(await findBrowser("/explicit/chromium", env), "/explicit/chromium");
    assert.equal(await findBrowser("", env), "/custom/chromium");
    assert.equal(await findBrowser("", { PATH: env.PATH }), chrome);
    assert.equal(await findBrowser("", { PATH: first }), undefined);
    assert.equal(await findBrowser("", {}), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
