import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("stage a file, commit it, then view a commit's diff in the drawer", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await expect(page.getByText("new.txt")).toBeVisible();
  await page.getByRole("button", { name: "Stage" }).click();

  await page.getByPlaceholder("Commit message").fill("add new.txt");
  await page.getByRole("button", { name: "Commit" }).click();

  await page.getByTestId("commit-row").first().click();
  await expect(page.getByText("second commit").last()).toBeVisible();
  await expect(page.getByText("a.txt")).toBeVisible();

  await page.getByRole("button", { name: "Side-by-side" }).click();
  await expect(page.getByText("one")).toBeVisible();
  await expect(page.getByText("two")).toBeVisible();
});
