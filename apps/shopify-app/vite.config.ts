import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// No installGlobals() here — this file is ESM (`"type": "module"` in package.json).
// Node 20+ has fetch/Request/Response built in, which Remix needs at runtime.

export default defineConfig({
  server: {
    allowedHosts: [
      "cool-draft-incorporate-expo.trycloudflare.com",
      process.env.SHOPIFY_APP_URL ? new URL(process.env.SHOPIFY_APP_URL).hostname : "",
      ".trycloudflare.com",
    ].filter(Boolean),
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? undefined,
    // OI-21: Raise body-size limit so 5MB selfies (≈6-8MB base64) are accepted.
    // Cast to avoid TS error if @types/vite predates this property.
    ...({ maxRequestBodySize: 10 * 1024 * 1024 } as Record<string, unknown>),
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      // Optional peer deps that are dynamically imported at runtime but are not
      // in `dependencies` (worker-only or env-gated). Rollup can't resolve them
      // at build time — tell it to leave the imports alone so the SSR bundle
      // stays compilable. They resolve correctly at runtime when the package is
      // actually installed (e.g. in apps/worker or via a dev install).
      //   • nodemailer      — email.server.ts, only when SMTP_HOST is set
      //   • @imgly/background-removal-node — imagery/studio.ts, worker-only
      //   • @prisma/client + .prisma/* — keep Prisma EXTERNAL so it loads at
      //     runtime as CommonJS. Bundling it leaks Prisma's internal
      //     `.prisma/client/default` specifier into the ESM bundle, which
      //     Node's ESM resolver rejects (ERR_INVALID_MODULE_SPECIFIER).
      external: ["nodemailer", "@imgly/background-removal-node", "@prisma/client", /^\.prisma\//],
    },
  },
});
