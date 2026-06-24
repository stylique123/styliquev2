/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (no build step). Next/webpack compiles them.
  // @stylique/ai ships TypeScript source (no separate build step). Include it
  // here so Next.js/webpack transpiles it alongside core/db/types.
  transpilePackages: ["@stylique/ai", "@stylique/core", "@stylique/db", "@stylique/types"],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.shopify.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "plus.unsplash.com" },
      // Our own asset host — muse/product/try-on images are served absolute from
      // here (so they also load on the Shopify storefront). next/image must
      // allowlist it or it refuses to optimize → broken image.
      { protocol: "https", hostname: "**.railway.app" },
    ],
  },

  experimental: {
    serverActions: { allowedOrigins: ["localhost:3001", "127.0.0.1:3001"] },
  },

  // Workspace packages use NodeNext-style relative imports with `.js` extensions
  // on `.ts` files (e.g. `export * from "./plans/index.js"`). That's correct for
  // tsx + Node ESM but webpack needs to be told the `.js` request can resolve to
  // a `.ts` source file. This mirrors what Node's ESM loader does and what vitest
  // already does natively.
  // Native server-only deps (sharp + the background-removal native .node binary)
  // must NOT be bundled by webpack — it chokes parsing the binary, and the local
  // darwin build wouldn't run on Railway's linux anyway. require() them at runtime.
  serverExternalPackages: ["@imgly/background-removal-node", "sharp"],

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), "@imgly/background-removal-node", "sharp"];
    }
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js":  [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
