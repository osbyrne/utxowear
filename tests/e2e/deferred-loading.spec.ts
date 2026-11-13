import { expect, test, type Page } from "@playwright/test";

async function suspendRequests(page: Page, pattern: string) {
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route(pattern, async (route) => {
    await promise;
    await route.continue();
  });
  return resolve;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/checkout", (route) => route.abort());
});

test("the homepage loads products without shirt assets and links to the shirt only in the footer", async ({
  page,
}) => {
  const releaseProducts = await suspendRequests(page, "**/_serverFn/**");
  const shirtRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/DeferredShirt-") || path.includes("/Shirt-") || path === "/tshirt.glb") {
      shirtRequests.push(path);
    }
  });

  try {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const html = await response?.text();
    expect(html).not.toContain("Bitcoin whitepaper abstract");
    expect(html).not.toContain("DeferredShirt");
    await expect(page.locator("#canvas-container")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Loading products" })).toBeAttached();
    await expect(page.getByRole("link", { name: "3D shirt", exact: true })).toHaveCount(1);
    const shirtLink = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "3D shirt", exact: true });
    await expect(shirtLink).toHaveAttribute("href", "/3d-shirt");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "3D shirt", exact: true }),
    ).toHaveCount(0);
    releaseProducts();
    await expect(page.locator("article").first()).toBeAttached();
    expect(shirtRequests).toEqual([]);
    await shirtLink.click();
    await expect(page).toHaveURL(/\/3d-shirt$/);
    await expect(page).toHaveTitle("3D shirt — utxowear");
    await expect(page.locator("#canvas-container svg")).toBeVisible();
  } finally {
    releaseProducts();
  }
});

test("the shirt page remains usable while the shirt code and model are loading", async ({
  page,
}) => {
  const releaseShirt = await suspendRequests(page, "**/assets/Shirt-*.js");
  const releaseModel = await suspendRequests(page, "**/tshirt.glb");

  try {
    const response = await page.goto("/3d-shirt", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const html = await response?.text();
    expect(html).toContain("Bitcoin whitepaper abstract");
    expect(html).not.toContain("/tshirt.glb");
    await expect(page.getByRole("link", { name: "utxowear home" })).toBeVisible();
    await expect(page.locator("#canvas-container svg")).toBeVisible();
    const initialBounds = await page.locator("#canvas-container").boundingBox();
    expect(initialBounds?.height).toBeGreaterThan(300);
    await expect(page.locator("canvas")).toHaveCount(0);

    const modelRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/tshirt.glb",
    );
    releaseShirt();
    await modelRequest;
    await expect(page.getByRole("status").filter({ hasText: "Loading 3D preview" })).toBeVisible();
    const modelResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/tshirt.glb",
    );
    releaseModel();
    expect((await modelResponse).status()).toBe(200);
    await expect(page.locator("#canvas-container canvas")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading 3D preview" })).toHaveCount(0);
    const finalBounds = await page.locator("#canvas-container").boundingBox();
    expect(finalBounds).toEqual(initialBounds);
    await expect(page.locator("#canvas-container canvas")).toHaveCSS("pointer-events", "none");
    await page.setViewportSize({ width: 430, height: 932 });
    await expect(page.locator("#canvas-container")).toHaveCSS("aspect-ratio", "1 / 1.15");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    releaseShirt();
    releaseModel();
  }
});

test("the homepage reports a failed catalog request and supports reloading", async ({ page }) => {
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Products could not load");
  await page.unroute("**/_serverFn/**");
  await page.getByRole("link", { name: "Reload", exact: true }).click();
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("product details reuse metadata data and defer rendering while preserving cart and 404 behavior", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const card = page.locator("article").first();
  const title = await card.getByRole("heading").innerText();
  const productPath = await card.getByRole("heading").getByRole("link").getAttribute("href");
  if (!productPath) throw new Error("Product link is missing.");
  const releaseDetails = await suspendRequests(page, "**/assets/Checkout-*.js");

  try {
    const response = await page.goto(productPath, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const html = await response?.text();
    expect(html).not.toContain('class="product-description"');
    await expect(page).toHaveTitle(`${title} — utxowear`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      `${title} — utxowear`,
    );
    const preview = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(preview).not.toContain("/images/link-preview.png");
    await expect(page.getByRole("status")).toContainText("Loading product details");
    await expect(page.getByRole("link", { name: "← All products" })).toHaveAttribute("href", "/");
    await expect(page.locator(".product-description")).toHaveCount(0);
    releaseDetails();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator(".product-description")).not.toBeEmpty();
    const gallery = page.getByRole("group", { name: `${title} mockups`, exact: true });
    const image = gallery.locator("img").first();
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect(image).toHaveAttribute("decoding", "async");
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.locator('[data-storefront-ready="true"]')).toBeAttached();
    const thumbnails = gallery.getByRole("group", { name: "Product mockups", exact: true });
    await expect(thumbnails).toBeVisible();
    await expect(gallery.getByRole("button", { name: /Previous mockup|Next mockup/ })).toHaveCount(
      0,
    );
    await expect(gallery.getByRole("slider")).toHaveCount(0);
    const buttons = thumbnails.getByRole("button");
    if ((await buttons.count()) > 1) {
      const source = await buttons.nth(1).locator("img").getAttribute("src");
      if (!source) throw new Error("Mockup thumbnail source is missing.");
      await buttons.nth(1).click();
      await expect(image).toHaveAttribute("src", source);
      await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await page.getByRole("button", { name: "Add to bag", exact: true }).click();
    await expect(page.getByRole("link", { name: "Shopping bag with 2 items" })).toBeVisible();
    await page.getByRole("link", { name: "Shopping bag with 2 items" }).click();
    await expect(page.locator("#cart").getByRole("spinbutton")).toHaveValue("2");
    const missing = await request.get("/products/missing-product-verification");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain("Product not found");
  } finally {
    releaseDetails();
  }
});

for (const asset of ["**/assets/Shirt-*.js", "**/tshirt.glb"]) {
  test(`a failed shirt asset (${asset}) leaves the page and abstract available`, async ({
    page,
  }) => {
    await page.route(asset, (route) => route.abort());
    await page.goto("/3d-shirt");
    await expect(
      page.getByRole("alert").filter({ hasText: "The 3D preview could not load" }),
    ).toBeVisible();
    await expect(page.locator("#canvas-container svg")).toBeVisible();
    await expect(page.getByRole("link", { name: "Reload", exact: true })).toHaveAttribute(
      "href",
      "/3d-shirt",
    );
    await expect(page.getByRole("link", { name: "utxowear home" })).toBeVisible();
  });
}

test("a failed product component download supports reloading without losing metadata", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.locator("article").first();
  const title = await card.getByRole("heading").innerText();
  const productPath = await card.getByRole("heading").getByRole("link").getAttribute("href");
  if (!productPath) throw new Error("Product link is missing.");
  await page.route("**/assets/Checkout-*.js", (route) => route.abort());
  await page.goto(productPath);
  await expect(page).toHaveTitle(`${title} — utxowear`);
  await expect(page.getByRole("alert")).toContainText("Product details could not load");
  await page.unroute("**/assets/Checkout-*.js");
  await page.getByRole("link", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});
