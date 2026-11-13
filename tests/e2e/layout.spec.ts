import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the header and footer retain visible borders and padding at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const header = page.getByRole("banner");
    const footer = page.getByRole("contentinfo");
    await expect(header).toBeInViewport();
    await expect(header).toHaveCSS("border-bottom-width", "1px");
    await expect(footer).toHaveCSS("border-top-width", "1px");
    const dimensions = await page.evaluate(() => {
      const header = document.querySelector("header");
      const navbar = header?.firstElementChild;
      const footer = document.querySelector("footer");
      const main = document.querySelector("main");
      if (!header || !navbar || !footer || !main) throw new Error("Page structure is missing.");
      return {
        headerHeight: header.getBoundingClientRect().height,
        headerPadding: parseFloat(getComputedStyle(navbar).paddingLeft),
        footerPadding: parseFloat(getComputedStyle(footer).paddingLeft),
        mainPadding: parseFloat(getComputedStyle(main).paddingLeft),
        footerVerticalPadding: parseFloat(getComputedStyle(footer).paddingTop),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(dimensions.headerHeight).toBeGreaterThanOrEqual(76);
    expect(dimensions.headerPadding).toBeGreaterThanOrEqual(16);
    expect(dimensions.headerPadding).toBe(dimensions.mainPadding);
    expect(dimensions.footerPadding).toBe(dimensions.mainPadding);
    expect(dimensions.footerVerticalPadding).toBeGreaterThanOrEqual(24);
    expect(dimensions.overflow).toBe(false);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
    await expect(footer.getByRole("link", { name: "3D shirt", exact: true })).toBeVisible();
    await header.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveTitle("About — utxowear");
    await expect(header).toHaveCSS("border-bottom-width", "1px");
    await expect(footer).toHaveCSS("border-top-width", "1px");
  });

  test(`the header and footer stay at the viewport edges while scrolling at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/contact");
    const header = page.getByRole("banner");
    const footer = page.getByRole("contentinfo");
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    for (const position of [0, 0.5, 1]) {
      await page.evaluate((position) => {
        window.scrollTo({
          top: (document.documentElement.scrollHeight - innerHeight) * position,
          behavior: "instant",
        });
      }, position);
      await expect(header).toBeInViewport({ ratio: 1 });
      await expect(footer).toBeInViewport({ ratio: 1 });
      const edges = await page.evaluate(() => {
        const header = document.querySelector("header");
        const footer = document.querySelector("footer");
        if (!header || !footer) throw new Error("Page boundaries are missing.");
        return {
          top: header.getBoundingClientRect().top,
          bottom: footer.getBoundingClientRect().bottom,
          viewportHeight: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(edges.top).toBeCloseTo(0, 0);
      expect(edges.bottom).toBeCloseTo(edges.viewportHeight, 0);
      expect(edges.overflow).toBe(false);
    }
    await page.getByRole("button", { name: "Send message" }).scrollIntoViewIfNeeded();
    const button = await page.getByRole("button", { name: "Send message" }).boundingBox();
    const footerBounds = await footer.boundingBox();
    if (!button || !footerBounds) throw new Error("Form controls are missing.");
    expect(button.y + button.height).toBeLessThanOrEqual(footerBounds.y);
  });
}

test("touch devices retain native vertical overscroll for pull-to-refresh", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/contact");
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "auto");
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-x", "none");
    expect(await page.evaluate(() => document.scrollingElement === document.documentElement)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
