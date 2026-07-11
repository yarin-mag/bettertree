import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("search commit history by content and filter by author", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await page.getByPlaceholder("Message or code...").fill("two");
  await page.getByRole("button", { name: "Search history" }).click();

  await expect(page.getByTestId("search-hit")).toBeVisible();
  await expect(page.getByTestId("search-hit").getByText("second commit")).toBeVisible();

  await page.getByPlaceholder("Author").fill("Nobody");
  await page.getByRole("button", { name: "Search history" }).click();

  await expect(page.getByTestId("search-hit")).not.toBeVisible();
});
