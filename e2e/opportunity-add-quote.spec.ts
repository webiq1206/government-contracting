import { test, expect } from "@playwright/test";

const BASE = "http://localhost:80";
const TEST_EMAIL = "testoperator@brostco.dev";
const TEST_PASSWORD = "testpass123";
const OPP_ID = "05c90f41-c69e-4fbc-95b8-646d70d016be";

test.describe("Opportunity detail — add quote via inline row edit (PATCH call-cards)", () => {
  test("entering a quote amount on an existing sub row saves it and displays it in the table", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(pipeline|call-queue|opportunity)/, { timeout: 15_000 });

    await page.goto(`${BASE}/opportunity/${OPP_ID}`);
    await expect(page.getByText("HVAC Replacement")).toBeVisible({ timeout: 10_000 });

    const quotesTable = page.locator("table");
    await expect(quotesTable).toBeVisible({ timeout: 8_000 });

    const elecRow = quotesTable.locator("tr").filter({ hasText: "Acme Electrical Solutions" });
    await expect(elecRow).toBeVisible({ timeout: 6_000 });

    await expect(elecRow.getByText("—")).toBeVisible();

    await elecRow.getByRole("button", { name: "Add quote" }).click();

    const amountInput = elecRow.locator('input[type="number"]');
    await expect(amountInput).toBeVisible({ timeout: 4_000 });
    await amountInput.fill("62500");

    await elecRow.getByRole("button", { name: "Save" }).click();

    await expect(amountInput).not.toBeVisible({ timeout: 10_000 });
    await expect(elecRow.getByText(/\$62,500/)).toBeVisible({ timeout: 8_000 });
  });
});
