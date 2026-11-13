import { expect, test, type Page } from "@playwright/test";

async function preparePayment(page: Page) {
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 503, json: { error: "Payment verification response." } }),
  );
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
  const payment = page.getByRole("button", { name: "Continue to secure payment", exact: true });
  await expect(payment).toBeDisabled();
  for (const [name, value] of Object.entries({
    first_name: "Payment",
    last_name: "Verification",
    email: "payment-test@example.com",
    phone: "+33142000000",
    address1: "5 Avenue Anatole France",
    city: "Paris",
    zip: "75007",
  })) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
  await page.getByRole("combobox", { name: "Country", exact: true }).selectOption("FR");
  await page.getByRole("button", { name: "Get shipping rates", exact: true }).click();
  await expect(payment).toBeEnabled();
  return payment;
}

for (const width of [1440, 390]) {
  test(`the payment flame has clearance and remains interactive at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const payment = await preparePayment(page);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await payment.scrollIntoViewIfNeeded();
      const output = page.locator('#cart canvas[aria-hidden="true"]');
      const effect = output.locator("..");
      await expect(output).toBeVisible();
      await expect(output).toHaveCSS("pointer-events", "none");
      const clearance = await effect.evaluate((element) => {
        const style = getComputedStyle(element);
        const canvas = element.querySelector('canvas[aria-hidden="true"]');
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Flame output is missing.");
        return {
          top: parseFloat(style.marginTop) + parseFloat(canvas.style.top),
          bottom: parseFloat(style.marginBottom) + parseFloat(canvas.style.bottom),
          side: parseFloat(style.marginLeft) + parseFloat(canvas.style.left),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(clearance.top).toBeGreaterThanOrEqual(0);
      expect(clearance.bottom).toBeGreaterThanOrEqual(0);
      expect(clearance.side).toBeGreaterThanOrEqual(0);
      expect(clearance.overflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`payment-${colorScheme}.png`) });
    }
    await payment.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Payment verification response.");
    await expect(payment).toBeEnabled();
  });
}

test("the payment button works without WebGL and with reduced motion", async ({
  playwright,
  baseURL,
}) => {
  const browser = await playwright.chromium.launch({
    ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
    args: ["--disable-webgl"],
  });
  try {
    const page = await browser.newPage({ baseURL });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    const payment = await preparePayment(page);
    await payment.click();
    await expect(page.getByRole("alert")).toHaveText("Payment verification response.");
    await expect(payment).toBeEnabled();
  } finally {
    await browser.close();
  }
});
