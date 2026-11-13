import { expect, test, type Locator } from "@playwright/test";

async function readColors(element: Locator) {
  return element.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Color measurement is unavailable.");

    function luminance(color: string) {
      if (!context) throw new Error("Color measurement is unavailable.");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels.reduce(
        (total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!,
        0,
      );
    }

    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return {
      foreground: style.color,
      background: style.backgroundColor,
      backgroundLuminance: background,
      contrast:
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  });
}

for (const width of [1440, 390]) {
  test(`the storefront follows browser appearance changes without reloading at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/contact");
    const header = page.getByRole("banner");
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    const submit = page.getByRole("button", { name: "Send message" });
    await expect(submit).toBeEnabled();
    await name.fill("Appearance verification");
    const initialColors = await readColors(header);

    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect
        .poll(async () => (await readColors(header)).backgroundLuminance > 0.5)
        .toBe(colorScheme === "light");
      for (const element of [header, name, submit]) {
        expect((await readColors(element)).contrast).toBeGreaterThanOrEqual(4.5);
      }
      await submit.hover();
      expect((await readColors(submit)).contrast).toBeGreaterThanOrEqual(4.5);
      await page.mouse.move(0, 0);
      await expect(name).toHaveValue("Appearance verification");
    }

    expect(await readColors(header)).toEqual(initialColors);
  });
}

test("dark appearance is applied before JavaScript runs", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    await page.goto("/contact");
    const colors = await readColors(page.getByRole("banner"));
    expect(colors.backgroundLuminance).toBeLessThan(0.1);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light dark");
  } finally {
    await context.close();
  }
});
