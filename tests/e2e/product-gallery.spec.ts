import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`mockup thumbnails appear only on the product page at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/checkout", (route) => route.abort());
    await page.goto("/");
    const card = page.locator("article").first();
    const title = await card.getByRole("heading").innerText();
    const gallery = card.getByRole("group", { name: `${title} mockups`, exact: true });
    await expect(gallery.locator("img")).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Product mockups", exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("button")).toHaveCount(0);
    const mainSource = await gallery.locator("img").getAttribute("src");
    await gallery.getByRole("link").click();
    await expect(page).toHaveURL(/\/products\/[^/]+$/);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const detailGallery = page.getByRole("group", { name: `${title} mockups`, exact: true });
    const detailImage = detailGallery.locator("img").first();
    const detailThumbnails = detailGallery.getByRole("group", {
      name: "Product mockups",
      exact: true,
    });
    const detailButtons = detailThumbnails.getByRole("button");
    await expect(detailThumbnails).toBeVisible();
    const detailSources = await detailThumbnails
      .locator("img")
      .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
    expect(detailSources.length).toBeGreaterThan(1);
    expect(detailSources.every(Boolean)).toBe(true);
    expect(new Set(detailSources).size).toBe(detailSources.length);
    expect(detailSources[0]).toBe(mainSource);
    const thumbnailSource = detailSources[1];
    if (!thumbnailSource) throw new Error("Mockup thumbnail source is missing.");
    const mainBounds = await detailImage.boundingBox();
    const thumbnailBounds = await detailThumbnails.boundingBox();
    if (!mainBounds || !thumbnailBounds) throw new Error("Mockup layout is missing.");
    expect(thumbnailBounds.y).toBeGreaterThanOrEqual(mainBounds.y + mainBounds.height);
    await expect(
      detailGallery.getByRole("button", { name: /Previous mockup|Next mockup/ }),
    ).toHaveCount(0);
    await detailButtons.nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(detailImage).toHaveAttribute("src", thumbnailSource);
    const variants = page.getByRole("combobox", { name: "Size / color", exact: true });
    const selectedVariant = await variants.inputValue();
    const options = await variants
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.getAttribute("value")));
    const otherVariant = options.find((value) => value && value !== selectedVariant);
    if (otherVariant) {
      await variants.selectOption(otherVariant);
      await expect(detailButtons.first()).toHaveAttribute("aria-pressed", "true");
      const source = await detailButtons.first().locator("img").getAttribute("src");
      if (!source) throw new Error("Variant mockup source is missing.");
      await expect(detailImage).toHaveAttribute("src", source);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
