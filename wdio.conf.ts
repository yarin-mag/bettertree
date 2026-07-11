import { createFixtureRepo, seedWorkspaceDb } from "./wdio-e2e/fixture";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./wdio-e2e/**/*.spec.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: "./src-tauri/target/release/bettertree",
        autoInstallTauriDriver: true,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: "./src-tauri/target/release/bettertree",
      },
    },
  ],
  logLevel: "info",
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
  reporters: ["spec"],
  // Must seed the fixture here, not in a spec's before() hook — the
  // service launches the app as part of session/worker startup, which
  // happens before any mocha hook in the spec file runs. Seeding in a
  // spec-level before() races the app's own startup data load and loses.
  onPrepare: async () => {
    const repoPath = createFixtureRepo();
    seedWorkspaceDb(repoPath, "real-fixture-repo");
  },
};
