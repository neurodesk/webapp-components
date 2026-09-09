import { defineConfig } from "@playwright/test";

// Serve the BUILT output so COOP/COEP headers (public/_headers, applied by the host)
// and worker/wasm asset paths are exercised — not just the dev server.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  webServer: {
    timeout: 120000,
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176/syncro/",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://127.0.0.1:4176/syncro/", launchOptions:{args:['--enable-unsafe-webgpu','--use-angle=swiftshader']} },
});
