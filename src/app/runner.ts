import { PostListError } from "./inputs.ts";
export async function runAccounts(
  accounts: string[],
  run: (account: string, report: any) => Promise<void>,
) {
  const reports: any[] = [];
  for (const account of accounts) {
    const report: any = { account, status: "failed", saved: [], skipped: [] };
    reports.push(report);
    try {
      await run(account, report);
      report.status = "complete";
    } catch (e) {
      report.error = String(e);
      report.failureKind =
        e instanceof PostListError
          ? "input_error"
          : /HTTP_DISCOVERY_UNAVAILABLE|HTTP_ORDER_UNVERIFIED/.test(String(e))
            ? "discovery_unavailable"
            : /DOM_UNSUPPORTED|Ambiguous|caption|timestamp|article/i.test(String(e))
              ? "dom_or_metadata_unsupported"
              : /HTTP (401|403|429)|restriction|CAPTCHA|Login\/challenge|login wall/i.test(
                    String(e),
                  )
                ? "access_restriction"
                : "fetch_or_storage_error";
      // Stop all access on a restriction, including all remaining accounts.
      if (
        !(e instanceof PostListError) &&
        /HTTP (401|403|429)|restriction|CAPTCHA|Login\/challenge|login wall/i.test(String(e))
      ) {
        for (const rest of accounts.slice(reports.length))
          reports.push({
            account: rest,
            status: "not_started",
            reason: "Stopped after access restriction",
          });
        break;
      }
    }
  }
  return reports;
}
