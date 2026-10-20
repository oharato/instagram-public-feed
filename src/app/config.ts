export function parseConfig(value: unknown): {
  accounts: string[];
  postUrls: Record<string, string[]>;
} {
  const accounts = (value as any)?.accounts;
  if (
    !Array.isArray(accounts) ||
    !accounts.length ||
    accounts.some(
      (a) =>
        typeof a !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$/.test(a) || a.includes(".."),
    )
  )
    throw new Error("accounts must be a nonempty array of valid account names");
  const normalized = [...new Set<string>(accounts.map((a) => a.toLowerCase()))];
  const postUrls = (value as any).postUrls ?? {};
  if (
    !postUrls ||
    typeof postUrls !== "object" ||
    Array.isArray(postUrls) ||
    Object.entries(postUrls).some(
      ([a, u]) =>
        !normalized.includes(a) || !Array.isArray(u) || u.some((x) => typeof x !== "string"),
    )
  )
    throw new Error("postUrls must map configured accounts to URL arrays");
  return { accounts: normalized, postUrls };
}
