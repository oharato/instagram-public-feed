import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parsePostLinks } from "./post-links.ts";

export class PostListError extends Error {}

export interface AccountInput {
  account: string;
  inputListFile?: string;
  urls?: string[];
}

export function selectAccounts(accounts: string[], selected: string): string[] {
  if (!selected) return accounts;
  const account = selected.toLowerCase();
  if (!accounts.includes(account)) throw new Error(`Account is not configured: ${selected}`);
  return [account];
}

async function readList(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new PostListError(`${file} がありません。先に pnpm urls を実行してください。`);
    throw new PostListError(`Cannot read post list ${file}: ${String(error)}`);
  }
}

function validateList(value: unknown, account: string, file: string): string[] {
  try {
    return parsePostLinks(value, account);
  } catch (error) {
    throw new PostListError(`Invalid post list ${file}: ${String(error)}`);
  }
}

export async function planAccountInputs(
  accounts: string[],
  root: string,
  useLists: boolean,
  fromList: string,
): Promise<AccountInput[]> {
  if (fromList) {
    const file = resolve(fromList);
    const value = await readList(file);
    const account = (value as { account?: unknown } | null)?.account;
    if (typeof account !== "string" || !accounts.includes(account))
      throw new PostListError(`Post list account must be one of: ${accounts.join(", ")}`);
    return [{ account, inputListFile: file, urls: validateList(value, account, file) }];
  }
  return accounts.map((account) => ({
    account,
    ...(useLists ? { inputListFile: join(root, account, "post-links.json") } : {}),
  }));
}

export async function loadAccountUrls(input: AccountInput): Promise<string[] | undefined> {
  if (input.urls) return input.urls;
  if (!input.inputListFile) return undefined;
  return validateList(await readList(input.inputListFile), input.account, input.inputListFile);
}
