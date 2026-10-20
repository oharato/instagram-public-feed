import { chromium } from "playwright-core";
import { postId } from "../posts/identity.ts";
import { recover } from "../posts/storage.ts";
import { mkdir, writeFile, open, rm, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseConfig } from "./config.ts";
import { runAccounts } from "./runner.ts";
import { aggregate } from "../posts/aggregate.ts";
import { httpAccount } from "../collection/http.ts";
import { checkBrowserDisplay } from "../collection/diagnostics.ts";
import { planAccountInputs, loadAccountUrls, selectAccounts } from "./inputs.ts";
import { findBrowser } from "../collection/browser.ts";
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args.shift() : undefined;
if (command && !["urls", "posts"].includes(command))
  throw new Error("Unknown command; use urls or posts");
function option(key: string, fallback: string) {
  const i = args.indexOf(key);
  if (i >= 0 && !args[i + 1]) throw new Error(`Missing ${key} value`);
  return i < 0 ? fallback : args[i + 1];
}
const configPath = option("--config", "config.json");
const config = parseConfig(
  JSON.parse(
    await readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        throw new Error(
          `${configPath} がありません。cp config.example.json config.json で設定ファイルを作成してください。`,
        );
      throw error;
    }),
  ),
);
const root = resolve(option("--out", "data"));
const mode = option("--mode", command === "urls" || command === "posts" ? "browser" : "http");
if (!["http", "browser"].includes(mode)) throw new Error("--mode must be http or browser");
const listOnly = command === "urls" || args.includes("--list-only");
if (listOnly && mode !== "browser") throw new Error("--list-only requires --mode browser");
const supplied = option("--url", "");
const fromList = option("--from-list", "");
const useLists = command === "posts" || Boolean(fromList);
const scrolls = Number(option("--scrolls", "0"));
if (!Number.isInteger(scrolls) || scrolls < 0 || scrolls > 50)
  throw new Error("--scrolls must be 0..50");
if (scrolls && (mode !== "browser" || useLists))
  throw new Error("--scrolls requires browser profile discovery (pnpm urls)");
if (useLists && (listOnly || supplied))
  throw new Error("--from-list cannot be combined with --list-only or --url");
const selectedAccounts = selectAccounts(config.accounts, option("--account", ""));
if (supplied && selectedAccounts.length !== 1)
  throw new Error("--url requires a single account; select one with --account");
const limitOption = option("--limit", "");
const limit = limitOption ? Number(limitOption) : useLists ? null : 3;
if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || (!useLists && limit > 3)))
  throw new Error(useLists ? "--limit must be a positive safe integer" : "--limit must be 1..3");
const inputs = await planAccountInputs(selectedAccounts, root, useLists, fromList);
const inputsByAccount = new Map(inputs.map((input) => [input.account, input]));
const executablePath = mode === "browser" ? await findBrowser(option("--browser", "")) : undefined;
await mkdir(root, { recursive: true });
const lock = await open(join(root, ".lock"), "wx").catch(() => {
  throw new Error("Output is locked; inspect any previous process before removing .lock");
});
let browser: any;
const report: any = {
  startedAt: new Date().toISOString(),
  limit,
  limitScope: "per_account",
  configuredAccounts: config.accounts,
  status: "failed",
  accounts: [],
};
try {
  checkBrowserDisplay(mode, args.includes("--headed"), process.platform, process.env);
  if (mode === "browser")
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: !args.includes("--headed"),
      chromiumSandbox: true,
    });
  report.mode = mode;
  report.listOnly = listOnly;
  if (fromList) report.inputListFile = resolve(fromList);
  report.accounts = await runAccounts(
    inputs.map((input) => input.account),
    async (account, r) => {
      await recover(join(root, account));
      const input = inputsByAccount.get(account)!;
      if (input.inputListFile) r.inputListFile = input.inputListFile;
      const listUrls = await loadAccountUrls(input);
      const accountLimit = limit ?? listUrls!.length;
      const selectedUrls = listUrls?.slice(0, accountLimit);
      r.limit = accountLimit;
      if (selectedUrls) {
        r.requestedUrls = selectedUrls;
      }
      if (mode === "browser") {
        const { scrape } = await import("../collection/scrape.ts");
        await scrape(
          browser,
          account,
          join(root, account),
          accountLimit,
          r,
          listOnly,
          selectedUrls,
          scrolls,
        );
      } else {
        const urls = selectedUrls ?? (supplied ? [supplied] : (config.postUrls[account] ?? []));
        for (const url of urls)
          if (!postId(url, account) || !url.startsWith("https://www.instagram.com/"))
            throw new Error("Invalid known post URL");
        await httpAccount(account, join(root, account), accountLimit, r, urls);
      }
    },
  );
  report.status = report.accounts.every((r: any) => r.status === "complete")
    ? "complete"
    : "failed";
  if (report.status !== "complete") process.exitCode = 1;
} catch (e) {
  report.error = String(e);
  report.accounts = inputs.map(({ account }) => ({
    account,
    status: "not_started",
    reason: "Setup failed",
  }));
  process.exitCode = 1;
  console.error(report.error);
} finally {
  try {
    await browser?.close();
    await aggregate(root, config.accounts);
  } catch (e) {
    report.finalizationError = String(e);
    report.status = "failed";
    process.exitCode = 1;
  }
  await lock.close();
  await rm(join(root, ".lock"), { force: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(join(root, "last-run.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
