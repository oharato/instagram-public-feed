import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";

export async function findBrowser(
  explicit: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (explicit) return explicit;
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  // Let Playwright use its installed browser when no system browser was found.
  return undefined;
}
