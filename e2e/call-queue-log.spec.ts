import { test, expect } from "@playwright/test";

const BASE = "http://localhost:80";
const TEST_EMAIL = "testoperator@brostco.dev";
const TEST_PASSWORD = "testpass123";
const OPP_ID = "05c90f41-c69e-4fbc-95b8-646d70d016be";

test.describe("Call queue — log a call with a quote", () => {
  test("logging a call removes the card from the queue and surfaces the quote on opportunity detail", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(pipeline|call-queue|opportunity)/, { timeout: 15_000 });

    await page.goto(`${BASE}/call-queue`);
    await expect(page.getByRole("heading", { name: "Call Queue" })).toBeVisible({ timeout: 10_000 });

    const hvacCard = page.locator(".card").filter({ hasText: "Southwest HVAC Pros" });
    await expect(hvacCard).toBeVisible({ timeout: 10_000 });

    const select = hvacCard.locator("select");
    await select.selectOption("quoted");

    const quoteInput = hvacCard.locator('input[type="number"]');
    await quoteInput.fill("75000");

    await hvacCard.getByRole("button", { name: "Save & close" }).click();

    await expect(page.getByText("Southwest HVAC Pros")).not.toBeVisible({ timeout: 12_000 });

    await page.goto(`${BASE}/opportunity/${OPP_ID}`);
    await expect(page.getByText("HVAC Replacement")).toBeVisible({ timeout: 10_000 });

    const quotesTable = page.locator("table");
    await expect(quotesTable).toBeVisible({ timeout: 8_000 });
    await expect(quotesTable.getByText("Southwest HVAC Pros")).toBeVisible();
    await expect(quotesTable.getByText(/\$75,000/)).toBeVisible();
  });
});
