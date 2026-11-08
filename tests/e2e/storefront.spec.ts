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
  await page.locator("article").first().getByRole("heading").getByRole("link").click();
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
    address1: "5 Avenue Anatole France",
    city: "Paris",
    zip: "75007",
  }))
    await bag.locator(`input[name="${name}"]`).fill(value);
  await bag.getByRole("combobox", { name: "Country", exact: true }).selectOption("FR");
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

test("Chrome autofill selects a valid country and country changes invalidate shipping", async ({
  page,
  context,
}) => {
  await page.goto("/products");
  await waitForStorefront(page);
  await page.locator("article").first().getByRole("heading").getByRole("link").click();
  await page.locator("article").first().getByRole("button", { name: "Add to bag" }).click();
  await page.getByRole("link", { name: /Shopping bag with/ }).click();
  await waitForStorefront(page);

  const country = page.getByRole("combobox", { name: "Country", exact: true });
  await expect(country).toHaveValue("");
  expect(await country.evaluate((element) => element.matches(":invalid"))).toBe(true);
  await expect(country.locator('option[value="ZZ"]')).toHaveCount(0);
  await country.focus();
  await page.keyboard.type("France");
  await expect(country).toHaveValue("FR");
  await country.selectOption("");

  const session = await context.newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: 'input[name="first_name"]',
    });
    const { node } = await session.send("DOM.describeNode", { nodeId });
    await session.send("Autofill.trigger", {
      fieldId: node.backendNodeId,
      address: {
        fields: [
          { name: "NAME_FIRST", value: "Address" },
          { name: "NAME_LAST", value: "Verification" },
          { name: "EMAIL_ADDRESS", value: "checkout-test@example.com" },
          { name: "PHONE_HOME_WHOLE_NUMBER", value: "+33142000000" },
          { name: "ADDRESS_HOME_COUNTRY", value: "France" },
          { name: "ADDRESS_HOME_STREET_ADDRESS", value: "5 Avenue Anatole France" },
          { name: "ADDRESS_HOME_CITY", value: "Paris" },
          { name: "ADDRESS_HOME_ZIP", value: "75007" },
        ],
      },
    });
    await expect(country).toHaveValue("FR");
    await page.route("**/api/shipping", (route) =>
      route.fulfill({
        json: {
          currency: "USD",
          subtotal: 2000,
          options: [{ method: 1, label: "Standard", price: 500, currency: "USD" }],
        },
      }),
    );
    const request = page.waitForRequest("**/api/shipping");
    await page.getByRole("button", { name: "Get shipping rates" }).click();
    expect((await request).postDataJSON().address.country).toBe("FR");
    const payment = page.getByRole("button", { name: "Continue to secure payment" });
    await expect(payment).toBeEnabled();
    await country.selectOption("GB");
    await expect(country).toHaveValue("GB");
    await expect(payment).toBeDisabled();
  } finally {
    await session.detach();
  }
});
