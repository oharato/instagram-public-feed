export function restrictedResponse(
  status: number,
  url: string,
  resourceType: string,
  mainDocument: boolean,
) {
  if (![401, 403, 429].includes(status)) return null;
  const parsed = new URL(url);
  // Query strings can contain tokens. Never store cookies, headers or response bodies.
  return { status, url: parsed.origin + parsed.pathname, resourceType, mainDocument };
}

export function isRouteDefinitionWarning(
  detail: NonNullable<ReturnType<typeof restrictedResponse>>,
) {
  const url = new URL(detail.url);
  return (
    detail.status === 429 &&
    !detail.mainDocument &&
    ["xhr", "fetch"].includes(detail.resourceType) &&
    url.origin === "https://www.instagram.com" &&
    url.pathname === "/ajax/bulk-route-definitions/"
  );
}

export function checkBrowserDisplay(
  mode: string,
  headed: boolean,
  platform: string,
  env: NodeJS.ProcessEnv,
) {
  if (
    mode === "browser" &&
    headed &&
    platform === "linux" &&
    !env.DISPLAY &&
    !env.WAYLAND_DISPLAY
  ) {
    throw new Error(
      "--headed requires a graphical session (DISPLAY or WAYLAND_DISPLAY). Run in a desktop terminal, or omit --headed. Headless mode does not resolve Instagram HTTP 429 restrictions.",
    );
  }
}
