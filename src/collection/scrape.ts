import type { Browser, Locator } from "playwright-core";
import { httpAccount, imageGet } from "./http.ts";
import { postId, selectTimestamp } from "../posts/identity.ts";
import { latest } from "../posts/ordering.ts";
import { saved, commit } from "../posts/storage.ts";
import { restrictedResponse, isRouteDefinitionWarning } from "./diagnostics.ts";
import { savePostLinks } from "../posts/links.ts";
import { parseCaptionBlock } from "./caption.ts";
import { discoverProfileLinks } from "./discovery.ts";
export async function scrape(
  browser: Browser,
  account: string,
  accountRoot: string,
  limit: number,
  report: any,
  listOnly = false,
  seedUrls?: string[],
  scrolls = 0,
) {
  if (seedUrls && (!seedUrls.length || listOnly))
    throw new Error("Seed URLs must be nonempty and cannot be combined with list-only");
  const context = await browser.newContext(); // Ephemeral: no storageState, cookies, or persistent profile.
  try {
    const page = await context.newPage();
    async function caption(root: Locator) {
      const headings = root.locator("h1");
      if ((await headings.count()) === 1)
        return { text: await headings.innerText(), source: "post_h1" };
      const text = parseCaptionBlock(await root.innerHTML(), account);
      if (text === null) throw new Error("DOM_UNSUPPORTED: ambiguous public caption");
      return { text, source: "post_public_caption_dom" };
    }
    async function postRoot(shortcode: string): Promise<Locator> {
      const links = page.locator("a[href]").filter({ has: page.locator("time[datetime]") });
      const matching = [];
      for (const a of await links.all())
        if (postId((await a.getAttribute("href")) || "", account) === shortcode) matching.push(a);
      if (matching.length !== 1) throw new Error("Ambiguous target timestamp");
      // Walk up from the exact permalink, selecting the smallest visible media + caption container.
      let root = matching[0];
      for (let i = 0; i < 16; i++) {
        root = root.locator("xpath=..");
        if (
          await root
            .locator("img")
            .evaluateAll((els) =>
              els.some(
                (el) =>
                  el.getBoundingClientRect().width > 200 && el.getBoundingClientRect().height > 150,
              ),
            )
        ) {
          try {
            await caption(root);
            return root;
          } catch {
            /* Keep looking for the caption beside the media. */
          }
        }
      }
      throw new Error("DOM_UNSUPPORTED: Cannot isolate caption and media around target permalink");
    }
    let denied: string | null = null;
    page.on("response", (r) => {
      const request = r.request();
      const detail = restrictedResponse(
        r.status(),
        r.url(),
        request.resourceType(),
        request.isNavigationRequest() && request.frame() === page.mainFrame(),
      );
      if (detail) {
        const responses = (report.restrictedResponses ??= []);
        const previous = responses.find(
          (x: any) =>
            x.status === detail.status &&
            x.url === detail.url &&
            x.resourceType === detail.resourceType &&
            x.mainDocument === detail.mainDocument,
        );
        if (previous) previous.count++;
        else responses.push({ ...detail, count: 1 });
        if (isRouteDefinitionWarning(detail))
          report.warnings = ["Route definitions returned HTTP 429; public DOM still required."];
        else
          denied ??= `HTTP ${detail.status} ${detail.url} (${detail.resourceType}, mainDocument=${detail.mainDocument})`;
      }
    });
    async function guard() {
      if (denied) throw new Error(denied);
      if (/accounts\/login|challenge|checkpoint/.test(page.url()))
        throw new Error("Login/challenge redirect");
      const text = await page.locator("body").innerText();
      if (
        /captcha|try again later|access denied|too many requests|不審なアクティビティ|しばらくしてからもう一度|アクセスが拒否/i.test(
          text,
        )
      )
        throw new Error("Access restriction/CAPTCHA detected");
    }
    async function navigate(url: string) {
      report.lastNavigationUrl = url;
      const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      report.lastPageUrl = new URL(page.url()).origin + new URL(page.url()).pathname;
      report.lastDocumentStatus = r?.status() ?? null;
      if (denied) throw new Error(denied);
      if (r && r.status() >= 400) throw new Error(`HTTP ${r.status()}`);
      await page.waitForTimeout(2000);
      await guard();
      // Only a visible, explicit close control may dismiss an optional signup dialog.
      for (const name of [/^Close$/i, /^閉じる$/]) {
        const b = page.getByRole("button", { name }).filter({ visible: true });
        if ((await b.count()) === 1) await b.click();
      }
      await guard();
    }
    let ids: string[];
    const knownUrls = new Map<string, string>();
    if (seedUrls) {
      for (const url of seedUrls.slice(0, limit)) {
        const id = postId(url, account);
        if (!id) throw new Error("Invalid known post URL");
        knownUrls.set(id, url);
      }
      ids = [...knownUrls.keys()];
    } else {
      await navigate(`https://www.instagram.com/${account}/`);
      const discovery = await discoverProfileLinks(account, scrolls, {
        guard,
        links: () =>
          page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") || "")),
        scroll: async () => {
          await page.mouse.wheel(0, 1600);
          await page.waitForTimeout(3500);
        },
        loginDialog: async () =>
          (await page.getByRole("dialog").filter({ visible: true }).allTextContents()).some(
            (text) => /log in|sign up|ログイン|登録/i.test(text),
          ),
        more: async () => {
          for (const text of [`${account}の投稿をもっと見る`, `See more posts from ${account}`]) {
            const button = page.getByText(text, { exact: true }).filter({ visible: true });
            if ((await button.count()) === 1) {
              await button.click();
              await page.waitForTimeout(5000);
              return true;
            }
          }
          return false;
        },
      });
      ids = discovery.ids;
      report.discovery = discovery;
      report.visibleShortcodes = ids;
      report.visiblePostUrls = ids.map((id) => `https://www.instagram.com/p/${id}/`);
      if (!ids.length) throw new Error("No public post links; login wall or changed DOM");
      report.postLinksFile = await savePostLinks(accountRoot, account, ids);
      console.error(`[${account}] Found ${ids.length} public post links: ${report.postLinksFile}`);
      if (discovery.stopReason === "login_wall")
        throw new Error("Login wall detected; links collected before it were saved");
      if (listOnly) {
        report.selection = "visible_profile_order_not_verified_latest";
        report.listed = ids.length;
        return;
      }
    }
    const posts: any[] = [];
    for (const shortcode of ids) {
      if (seedUrls && (await saved(accountRoot, shortcode))) {
        report.skipped.push(shortcode);
        continue;
      }
      await page.waitForTimeout(3000);
      const url = knownUrls.get(shortcode) ?? `https://www.instagram.com/p/${shortcode}/`;
      await navigate(url);
      // Require the target permalink's own timestamp, never an image alt date or comment time.
      const times = page.locator("a[href]").filter({ has: page.locator("time[datetime]") });
      const target = [];
      for (const a of await times.all())
        if (postId((await a.getAttribute("href")) || "", account) === shortcode) target.push(a);
      if (target.length !== 1)
        throw new Error(`Ambiguous target timestamp: ${shortcode} (${target.length})`);
      const publishedAt = selectTimestamp(
        [
          {
            href: (await target[0].getAttribute("href")) || "",
            datetime: await target[0].locator("time").getAttribute("datetime"),
          },
        ],
        account,
        shortcode,
      );
      posts.push({
        source: "browser",
        publishedAtSource: "target_permalink_time_datetime",
        account,
        shortcode,
        url,
        publishedAt,
      });
    }
    report.compared = posts.map(({ shortcode, publishedAt }) => ({ shortcode, publishedAt }));
    for (const post of seedUrls ? posts : latest(posts, limit)) {
      if (await saved(accountRoot, post.shortcode)) {
        report.skipped.push(post.shortcode);
        continue;
      }
      await page.waitForTimeout(3000);
      await navigate(post.url);
      let article: Locator;
      try {
        article = await postRoot(post.shortcode);
      } catch (e) {
        report.mediaFallback = String(e);
        report.incomplete = true;
        await httpAccount(account, accountRoot, limit, report, [post.url], {
          publishedAt: post.publishedAt,
          publishedAtSource: post.publishedAtSource,
          discoverySource: "browser",
          carouselReason: "DOM_UNSUPPORTED: HTTP preview only",
        });
        continue;
      }
      const { text, source: captionStatus } = await caption(article);
      if ((await article.count()) !== 1) throw new Error("Ambiguous media article");
      const urls = new Map<string, string>();
      let carouselComplete = false,
        reason = "UI step limit";
      for (let step = 0; step < 20; step++) {
        await guard();
        const imgs = await article.locator("img").evaluateAll((els) =>
          els
            .filter(
              (el) =>
                el.getBoundingClientRect().width > 200 && el.getBoundingClientRect().height > 150,
            )
            .map((el) => ({
              src: (el as HTMLImageElement).currentSrc,
              alt: (el as HTMLImageElement).alt,
              x: Math.round(el.getBoundingClientRect().x),
              y: Math.round(el.getBoundingClientRect().y),
            })),
        );
        for (const im of imgs)
          if (im.src) {
            const u = new URL(im.src);
            urls.set(u.origin + u.pathname, im.src);
          }
        if (await article.locator("video").count()) {
          reason = "Video media is outside image-only scope";
          break;
        }
        const next = article
          .getByRole("button", { name: /^(Next|次へ)$/i })
          .filter({ visible: true });
        if ((await next.count()) === 0) {
          carouselComplete = true;
          reason = "No next button in post UI";
          break;
        }
        if ((await next.count()) !== 1) {
          reason = "Ambiguous next button";
          break;
        }
        const before = JSON.stringify(imgs);
        await next.click();
        await page.waitForTimeout(1200);
        const after = await article.locator("img").evaluateAll((els) =>
          els
            .filter(
              (el) =>
                el.getBoundingClientRect().width > 200 && el.getBoundingClientRect().height > 150,
            )
            .map((el) => ({
              src: (el as HTMLImageElement).currentSrc,
              alt: (el as HTMLImageElement).alt,
              x: Math.round(el.getBoundingClientRect().x),
              y: Math.round(el.getBoundingClientRect().y),
            })),
        );
        if (JSON.stringify(after) === before) {
          if ((await next.count()) === 0) {
            carouselComplete = true;
            reason = "No next button after final UI step";
            break;
          }
          reason = "Carousel did not advance";
          break;
        }
      }
      const result = await commit(
        accountRoot,
        {
          ...post,
          text,
          captionStatus,
          imageUrls: [...urls.values()],
          imagesComplete: carouselComplete,
          carouselComplete,
          carouselReason: reason,
          fetchedAt: new Date().toISOString(),
        },
        imageGet,
      );
      report.saved.push({
        shortcode: post.shortcode,
        status: result.status,
        imageCount: result.imageCount,
      });
      console.error(
        `[${account}] ${post.shortcode}: saved ${result.imageCount} images (${result.status})`,
      );
      if (!carouselComplete) throw new Error(`Partial carousel: ${post.shortcode}: ${reason}`);
    }
    report.selection = seedUrls
      ? "explicit_saved_list_order"
      : "latest_visible_by_permalink_datetime";
    if (report.incomplete)
      throw new Error("DOM_UNSUPPORTED: HTTP previews saved; full carousel collection incomplete");
  } finally {
    await context.close();
  }
}
