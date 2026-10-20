import test from "node:test";
import assert from "node:assert/strict";
import {
  restrictedResponse,
  checkBrowserDisplay,
  isRouteDefinitionWarning,
} from "../src/diagnostics.ts";

test("only rate-limited route-definition background requests are warnings", () => {
  const detail = restrictedResponse(
    429,
    "https://www.instagram.com/ajax/bulk-route-definitions/",
    "xhr",
    false,
  )!;
  assert.equal(isRouteDefinitionWarning(detail), true);
  for (const change of [
    { status: 403 },
    { status: 401 },
    { mainDocument: true },
    { resourceType: "document" },
    { url: "https://www.instagram.com/api/posts/" },
    { url: "https://example.invalid/ajax/bulk-route-definitions/" },
  ]) {
    assert.equal(isRouteDefinitionWarning({ ...detail, ...change }), false);
  }
});

test("restriction diagnostics distinguish document and subresource and omit tokens", () => {
  assert.deepEqual(
    restrictedResponse(
      429,
      "https://www.instagram.com/api/example/?token=secret#private",
      "fetch",
      false,
    ),
    {
      status: 429,
      url: "https://www.instagram.com/api/example/",
      resourceType: "fetch",
      mainDocument: false,
    },
  );
  assert.equal(restrictedResponse(200, "https://www.instagram.com/", "document", true), null);
  assert.equal(
    restrictedResponse(403, "https://www.instagram.com/", "document", true)?.mainDocument,
    true,
  );
});

test("headed Linux requires display but headless and desktop sessions remain allowed", () => {
  assert.throws(() => checkBrowserDisplay("browser", true, "linux", {}), /graphical session/);
  checkBrowserDisplay("browser", false, "linux", {});
  checkBrowserDisplay("http", true, "linux", {});
  checkBrowserDisplay("browser", true, "linux", { DISPLAY: ":0" });
  checkBrowserDisplay("browser", true, "linux", { WAYLAND_DISPLAY: "wayland-0" });
  checkBrowserDisplay("browser", true, "darwin", {});
});
