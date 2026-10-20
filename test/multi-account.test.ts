import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("posts handles multiple account lists, per-account limits, isolated failures, and complete aggregation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-multi-cli-"));
  const accounts = ["fixture.one", "fixture.two"];
  const out = join(root, "data"),
    log = join(root, "requests.log");
  const args = [
    "--import",
    resolve("test/fixtures/list-fetch.mjs"),
    resolve("src/cli.ts"),
    "posts",
    "--mode",
    "http",
  ];
  const env: NodeJS.ProcessEnv = { ...process.env, IG_LIST_TEST_LOG: log };
  delete env.NODE_TEST_CONTEXT;
  const readJSON = async (file: string) => JSON.parse(await readFile(file, "utf8"));
  const report = () => readJSON(join(out, "last-run.json"));
  const aggregate = () => readJSON(join(out, "posts.json"));
  const listFile = (account: string) => join(out, account, "post-links.json");
  const writeList = async (account: string, ids = [1, 2]) =>
    writeFile(
      listFile(account),
      JSON.stringify({
        account,
        posts: ids.map((id) => ({ url: `https://www.instagram.com/${account}/p/Synthetic${id}/` })),
      }),
    );
  try {
    await writeFile(join(root, "config.json"), JSON.stringify({ accounts }));
    for (const account of accounts) {
      await mkdir(join(out, account), { recursive: true });
      await writeList(account);
    }
    await run(process.execPath, [...args, "--limit", "1"], { env, cwd: root });
    assert.deepEqual(
      (await report()).accounts.map((a: any) => ({
        account: a.account,
        status: a.status,
        limit: a.limit,
        requested: a.requestedUrls.length,
      })),
      accounts.map((account) => ({ account, status: "complete", limit: 1, requested: 1 })),
    );
    let combined = await aggregate();
    assert.deepEqual(combined.accounts, accounts);
    assert.equal(combined.posts.length, 2);
    assert.deepEqual(
      combined.posts.map((p: any) => p.shortcode),
      ["Synthetic1", "Synthetic1"],
    );
    assert.notEqual(combined.posts[0].path, combined.posts[1].path);

    await run(process.execPath, args, { env, cwd: root });
    assert.equal((await report()).limit, null);
    assert.equal((await aggregate()).posts.length, 4);
    const requests = await readFile(log, "utf8");
    assert.equal(requests.trim().split("\n").length, 8);
    for (const account of accounts) {
      const p = await readJSON(join(out, account, "Synthetic1", "post.json"));
      assert.equal(p.account, account);
      assert.equal(p.text, "Synthetic caption & details");
    }
    await run(process.execPath, [...args, "--account", "fixture.two", "--limit", "1"], {
      env,
      cwd: root,
    });
    assert.deepEqual(
      (await report()).accounts.map((a: any) => a.account),
      ["fixture.two"],
    );
    assert.equal((await aggregate()).posts.length, 4);
    await run(process.execPath, [...args, "--from-list", listFile("fixture.two")], {
      env,
      cwd: root,
    });
    assert.deepEqual(
      (await report()).accounts.map((a: any) => a.account),
      ["fixture.two"],
    );
    assert.equal((await aggregate()).posts.length, 4);
    assert.equal(await readFile(log, "utf8"), requests);

    // Missing/broken lists fail one account and retain all saved data.
    await rm(listFile("fixture.one"));
    await assert.rejects(run(process.execPath, args, { env, cwd: root }));
    let result = await report();
    assert.equal(result.accounts[0].failureKind, "input_error");
    assert.equal(result.accounts[1].status, "complete");
    assert.equal((await aggregate()).posts.length, 4);
    await writeFile(listFile("fixture.one"), "invalid JSON");
    await assert.rejects(run(process.execPath, args, { env, cwd: root }));
    result = await report();
    assert.equal(result.accounts[0].failureKind, "input_error");
    assert.equal(result.accounts[1].status, "complete");
    assert.equal(await readFile(log, "utf8"), requests);

    // A real restriction stops the next account and preserves prior results.
    await writeList("fixture.one", [3]);
    await assert.rejects(
      run(process.execPath, args, { env: { ...env, IG_LIST_TEST_DENIED: "1" }, cwd: root }),
    );
    result = await report();
    assert.deepEqual(
      result.accounts.map((a: any) => a.status),
      ["failed", "not_started"],
    );
    assert.equal(result.accounts[0].failureKind, "access_restriction");
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 9);
    combined = await aggregate();
    assert.equal(combined.posts.length, 4);
    assert.deepEqual(combined.accounts, accounts);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
