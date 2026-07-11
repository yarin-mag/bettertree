// BLOCKED: automated assertions below are written to document the intended
// test, but are skipped. The embedded WebDriver session connects (window
// handle "main" resolves, the plugin's init handshake completes) but
// document.body.innerHTML and window.__TAURI__ are both empty/undefined on
// that session — the automated session isn't seeing the app's real webview
// content, in both dev-server and bundled-dist builds. This reproduces with
// the app working correctly when launched standalone (verified manually),
// so the gap looks like it's in tauri-plugin-wdio-webdriver / @wdio/tauri-service
// itself (a ~months-old tool solving an otherwise-unsolved macOS WKWebView
// WebDriver gap), not in this project's setup. See docs/superpowers/plans/
// 2026-07-06-bettertree-real-e2e-testing.md for the full investigation.
describe("real app smoke test", () => {
  it.skip("loads the seeded repo and shows its real branch and commit via actual Rust<->JSON IPC", async () => {
    const repoButton = await $("button=real-fixture-repo");
    await repoButton.click();

    const branchLabel = await $("span=main");
    await expect(branchLabel).toBeDisplayed();

    const commitRow = await $('[data-testid="commit-row"]');
    await expect(commitRow).toBeDisplayed();
    await expect(commitRow).toHaveText("first commit", { containing: true });
  });
});
