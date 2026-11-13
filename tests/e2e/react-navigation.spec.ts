import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/checkout", (route) => route.abort());
});

test("React navigation retains the bag across information pages and reloads", async ({ page }) => {
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests.push(request.url());
  });
  await page.goto("/");
  await page.locator("article").first().getByRole("heading").getByRole("link").click();
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  const bagLink = page.getByRole("link", { name: "Shopping bag with 1 item", exact: true });
  await expect(bagLink).toBeVisible();
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveTitle("About — utxowear");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
  await expect(bagLink).toBeVisible();
  await page.getByRole("link", { name: "Contact", exact: true }).click();
  await expect(page).toHaveTitle("Contact — utxowear");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(bagLink).toBeVisible();
  expect(documentRequests).toHaveLength(1);
  await page.reload();
  await expect(bagLink).toBeVisible();
  await bagLink.click();
  await expect(page.locator("#cart")).toBeVisible();
  await expect(page.locator("#cart").getByRole("spinbutton")).toHaveValue("1");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the React contact form retains failed submissions and clears a successful submission", async ({
  page,
}) => {
  await page.goto("/contact");
  const form = page.locator("#contact-form");
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Contact verification");
  await form.getByRole("textbox", { name: "Email", exact: true }).fill("contact-test@example.com");
  await form
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Contact form verification.");
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      status: 502,
      json: { message: "Your message could not be sent. Please try again later." },
    }),
  );
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("status")).toContainText("Your message could not be sent");
  await expect(form.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Contact form verification.",
  );
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      json: { message: "Thank you. Your message has been submitted." },
    }),
  );
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("status")).toContainText("Thank you.");
  await expect(form.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
});

test("a delayed catalog keeps its recovery action available", async ({ page }) => {
  await page.clock.install();
  const { promise, resolve } = Promise.withResolvers<void>();
  await page.route("**/_serverFn/**", async (route) => {
    await promise;
    await route.continue();
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Loading products");
    await page.clock.fastForward(15_000);
    await expect(page.getByRole("alert")).toContainText("Loading is taking longer than expected");
    await expect(page.getByRole("link", { name: "Reload", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    resolve();
    await expect(page.locator("article").first()).toBeVisible();
  } finally {
    resolve();
  }
});

test("unknown routes return a server 404 and render the React fallback", async ({
  page,
  request,
}) => {
  const response = await request.get("/missing-route-verification");
  expect(response.status()).toBe(404);
  await page.goto("/missing-route-verification");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("a shipping response enables payment and cancellation retains the React bag", async ({
  page,
  baseURL,
}) => {
  await page.route("**/api/shipping", (route) =>
    route.fulfill({
      json: {
        currency: "USD",
        subtotal: 2000,
        options: [{ method: 1, label: "Standard", price: 500, currency: "USD" }],
      },
    }),
  );
  await page.goto("/");
  await page.locator("article").first().getByRole("heading").getByRole("link").click();
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await page.getByRole("link", { name: "Shopping bag with 1 item", exact: true }).click();
  const bag = page.locator("#cart");
  const payment = bag.getByRole("button", { name: "Continue to secure payment", exact: true });
  await expect(payment).toBeDisabled();
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
  await bag.getByRole("button", { name: "Get shipping rates", exact: true }).click();
  await expect(payment).toBeEnabled();
  await page.route("**/api/checkout", (route) =>
    route.fulfill({
      json: { url: "https://checkout.stripe.com/c/pay/cancellation-verification" },
    }),
  );
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: `${baseURL}/cart?checkout=cancel` },
    }),
  );
  const checkoutRequest = page.waitForRequest("**/api/checkout");
  await payment.click();
  expect((await checkoutRequest).postDataJSON()).toMatchObject({
    expectedTotal: 2500,
    currency: "USD",
    shippingMethod: 1,
  });
  await expect(page).toHaveURL(/checkout=cancel/);
  await expect(page.locator("#cart")).toContainText("Checkout was canceled");
  await expect(
    page.getByRole("link", { name: "Shopping bag with 1 item", exact: true }),
  ).toBeVisible();
});
