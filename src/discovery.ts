import { postId } from "./core.ts";

interface DiscoveryUi {
  links(): Promise<string[]>;
  scroll(): Promise<void>;
  more(): Promise<boolean>;
  guard(): Promise<void>;
  loginDialog(): Promise<boolean>;
}

export async function discoverProfileLinks(account: string, scrolls: number, ui: DiscoveryUi) {
  const ids = new Set<string>();
  const steps: { action: string; count: number }[] = [];
  const result = (stopReason: string) => ({ ids: [...ids], steps, stopReason });
  async function collect() {
    for (const href of await ui.links()) {
      const id = postId(href, account);
      if (id) ids.add(id);
    }
  }
  await ui.guard();
  if (await ui.loginDialog()) return result("login_wall");
  await collect();
  steps.push({ action: "initial", count: ids.size });
  if (!scrolls || !ids.size) return result("initial_only");
  let unchanged = 0,
    usedMore = false;
  for (let step = 0; step < scrolls; step++) {
    await ui.guard();
    const before = ids.size;
    await ui.scroll();
    await ui.guard();
    // Do not read links behind a login wall; preserve previously confirmed links.
    if (await ui.loginDialog()) return result("login_wall");
    await collect();
    steps.push({ action: "scroll", count: ids.size });
    unchanged = ids.size === before ? unchanged + 1 : 0;
    if (unchanged < 3) continue;
    if (!usedMore && (await ui.more())) {
      usedMore = true;
      await ui.guard();
      if (await ui.loginDialog()) return result("login_wall");
      await collect();
      steps.push({ action: "see_more", count: ids.size });
      unchanged = 0;
    } else return result("no_new_links");
  }
  return result("scroll_limit");
}
