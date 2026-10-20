import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("CLI imports the whole list, saves URL/caption/image, and skips saved posts on rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-from-list-"));
  try {
    const config = join(root, "config.json"),
      list = join(root, "links.json"),
      out = join(root, "data"),
      log = join(root, "requests.log");
    await writeFile(config, JSON.stringify({ accounts: ["fixture.one"] }));
    const posts = Array.from({ length: 4 }, (_, i) => ({
      url: `https://www.instagram.com/p/Synthetic${i + 1}/`,
    }));
    await writeFile(list, JSON.stringify({ account: "fixture.one", posts: [...posts, posts[0]] }));
    const args = [
      "--import",
      resolve("test/fixtures/list-fetch.mjs"),
      resolve("src/cli.ts"),
      "--config",
      config,
      "--from-list",
      list,
      "--out",
      out,
    ];
    const env: NodeJS.ProcessEnv = { ...process.env, IG_LIST_TEST_LOG: log };
    delete env.NODE_TEST_CONTEXT;
    await run(process.execPath, args, { env });
    const readReport = async () => JSON.parse(await readFile(join(out, "last-run.json"), "utf8"));
    assert.equal((await readReport()).status, "complete");
    const saved = JSON.parse(await readFile(join(out, "posts.json"), "utf8")).posts;
    assert.equal(saved.length, 4);
    for (const post of saved) {
      assert.equal(post.text, "Synthetic caption & details");
      assert.equal(post.status, "preview_only");
      assert.equal(post.imagesComplete, false);
      assert.ok(posts.some((p) => p.url === post.url));
      assert.equal(
        (await readFile(join(out, "fixture.one", post.shortcode, post.images[0].file)))[0],
        255,
      );
    }
    const requests = await readFile(log, "utf8");
    assert.equal(requests.trim().split("\n").length, 8);
    await run(process.execPath, args, { env });
    const rerun = await readReport();
    assert.equal(rerun.accounts[0].skipped.length, 4);
    assert.equal(await readFile(log, "utf8"), requests);
    await run(process.execPath, [...args, "--limit", "2"], { env });
    const limited = await readReport();
    assert.equal(limited.accounts[0].requestedUrls.length, 2);
    assert.equal(limited.accounts[0].skipped.length, 2);

    // Short command discovers config.json and the saved list with no path flags.
    await writeFile(join(out, "fixture.one", "post-links.json"), await readFile(list));
    await run(
      process.execPath,
      [
        "--import",
        resolve("test/fixtures/list-fetch.mjs"),
        resolve("src/cli.ts"),
        "posts",
        "--mode",
        "http",
      ],
      { env, cwd: root },
    );
    const shortCommand = await readReport();
    assert.equal(shortCommand.status, "complete");
    assert.equal(shortCommand.accounts[0].skipped.length, 4);
    assert.equal(await readFile(log, "utf8"), requests);

    // Restriction stops before the second post; previously saved output remains intact.
    const deniedOut = join(root, "denied");
    await assert.rejects(
      run(
        process.execPath,
        args.map((value) => (value === out ? deniedOut : value)),
        { env: { ...env, IG_LIST_TEST_DENIED: "1" } },
      ),
    );
    const denied = JSON.parse(await readFile(join(deniedOut, "last-run.json"), "utf8"));
    assert.equal(denied.accounts[0].failureKind, "access_restriction");
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 9);
    assert.equal(JSON.parse(await readFile(join(out, "posts.json"), "utf8")).posts.length, 4);

    // Input errors are rejected before any fetch.
    await writeFile(list, JSON.stringify({ account: "fixture.two", posts }));
    await assert.rejects(run(process.execPath, args, { env }));
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 9);
    await assert.rejects(
      run(process.execPath, [...args, "--list-only", "--mode", "browser"], { env }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
