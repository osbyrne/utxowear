import { expect, test, type Page } from "@playwright/test";

async function waitForStorefront(page: Page) {
  // Astro renders the form before React attaches its input handlers.
  await expect(page.locator('astro-island[component-url*="Checkout"]:not([ssr])')).toBeAttached();
}

// These tests can run against production: external catalog/shipping reads are real,
// but every checkout submission is blocked unless the test supplies a fake redirect.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/checkout", (route) => route.abort());
});

test("shirts and images load, and catalog search finds a product", async ({ page }) => {
  await page.goto("/");
  await waitForStorefront(page);
  await expect(page.locator("article").first()).toBeVisible();
  for (const image of await page.locator("article img").all()) {
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
  await page.getByRole("link", { name: "Search products" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await waitForStorefront(page);
  const name = await page.locator("article h3").first().innerText();
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill(name);
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article h3")).toHaveText(name);
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("no-such-shirt-e2e");
  await expect(page.locator("article")).toHaveCount(0);
});

test("the bag retains quantities across pages and lets the buyer remove an item", async ({
  page,
}) => {
  await page.goto("/products");
  await waitForStorefront(page);
  const card = page.locator("article").first();
  const name = await card.getByRole("heading").innerText();
  await card.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await card.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("link", { name: "Shopping bag with 2 items" })).toBeVisible();
  await page.getByRole("link", { name: "utxowear home" }).click();
  await expect(page.locator("#cart")).toHaveCount(0);
  await page.getByRole("link", { name: /Shopping bag with/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await waitForStorefront(page);
  const bag = page.locator("#cart");
  await expect(bag).toContainText(name);
  await expect(bag.getByRole("spinbutton")).toHaveValue("2");
  await bag.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByRole("link", { name: "Shopping bag with 0 items" })).toBeVisible();
  await expect(bag.getByRole("button", { name: /Remove/ })).toHaveCount(0);
});

test("a real shipping quote enables USD checkout and cancellation preserves the bag", async ({
  page,
  baseURL,
}) => {
  await page.goto("/products");
  await waitForStorefront(page);
  await page.locator("article").first().getByRole("button", { name: "Add to bag" }).click();
  await expect(page.locator("#cart")).toHaveCount(0);
  await page.getByRole("link", { name: /Shopping bag with/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await waitForStorefront(page);
  const bag = page.locator("#cart");
  const pay = bag.getByRole("button", { name: "Continue to secure payment" });
  await expect(pay).toBeDisabled();
  for (const [name, value] of Object.entries({
    first_name: "Checkout",
    last_name: "Verification",
    email: "checkout-test@example.com",
    phone: "+33142000000",
    country: "FR",
    address1: "5 Avenue Anatole France",
    city: "Paris",
    zip: "75007",
  }))
    await bag.locator(`input[name="${name}"]`).fill(value);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/shipping" && r.request().method() === "POST",
  );
  await bag.getByRole("button", { name: "Get shipping rates" }).click();
  const shipping = await response;
  expect(shipping.status()).toBe(200);
  const quote: {
    currency: string;
    subtotal: number;
    options: { method: number; price: number }[];
  } = await shipping.json();
  expect(quote.currency).toBe("USD");
  expect(quote.options.length).toBeGreaterThan(0);
  await expect(pay).toBeEnabled();

  const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/checkout");
  await page.route("**/api/checkout", (route) =>
    route.fulfill({
      json: { url: "https://checkout.stripe.com/c/pay/e2e-cancel" },
    }),
  );
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: `${baseURL!.replace(/\/$/, "")}/cart?checkout=cancel` },
    }),
  );
  await pay.click();
  const checkout = (await request).postDataJSON();
  expect(checkout.currency).toBe("USD");
  const selected = quote.options.find((option) => option.method === checkout.shippingMethod);
  expect(selected).toBeTruthy();
  expect(checkout.expectedTotal).toBe(quote.subtotal + selected!.price);
  await expect(page).toHaveURL(/checkout=cancel/);
  await expect(page.locator("#cart")).toContainText("Checkout was canceled");
  await expect(page.getByRole("link", { name: "Shopping bag with 1 item" })).toBeVisible();
});
