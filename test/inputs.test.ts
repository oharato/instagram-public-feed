import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planAccountInputs,
  selectAccounts,
  loadAccountUrls,
  PostListError,
} from "../src/inputs.ts";

test("input plans isolate account lists and explicit files select their configured owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-inputs-"));
  const accounts = ["fixture.one", "fixture.two"];
  try {
    assert.deepEqual(selectAccounts(accounts, ""), accounts);
    assert.deepEqual(selectAccounts(accounts, "Fixture.Two"), ["fixture.two"]);
    assert.throws(() => selectAccounts(accounts, "other"));
    const plans = await planAccountInputs(accounts, root, true, "");
    assert.deepEqual(
      plans.map((p) => p.inputListFile),
      accounts.map((a) => join(root, a, "post-links.json")),
    );
    await assert.rejects(loadAccountUrls(plans[0]), PostListError);
    await mkdir(join(root, "fixture.two"));
    const file = plans[1].inputListFile!;
    await writeFile(
      file,
      JSON.stringify({
        account: "fixture.two",
        posts: [{ url: "https://www.instagram.com/fixture.two/p/Synthetic1/" }],
      }),
    );
    assert.deepEqual(await loadAccountUrls(plans[1]), [
      "https://www.instagram.com/fixture.two/p/Synthetic1/",
    ]);
    const explicit = await planAccountInputs(accounts, root, true, file);
    assert.equal(explicit.length, 1);
    assert.equal(explicit[0].account, "fixture.two");
    await assert.rejects(planAccountInputs(["fixture.one"], root, true, file), PostListError);
    const noLists = await planAccountInputs(accounts, root, false, "");
    assert.equal(await loadAccountUrls(noLists[0]), undefined);
    await writeFile(file, "invalid JSON");
    await assert.rejects(loadAccountUrls(plans[1]), PostListError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
