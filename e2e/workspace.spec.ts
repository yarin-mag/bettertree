import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mockTauri";

test("add a repo, browse its branches and graph, then search", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add repo" }).click();
  await page.getByText("repo-a").click();

  await expect(page.getByText("Branches")).toBeVisible();
  await expect(page.getByTestId("commit-row").first()).toBeVisible();
  await expect(page.getByText("second commit")).toBeVisible();

  await page.getByPlaceholder("Search branches, tags, commits...").fill("orig");
  await expect(page.getByText("origin/main")).toBeVisible();
  await expect(page.getByText("main", { exact: true })).not.toBeVisible();
});
