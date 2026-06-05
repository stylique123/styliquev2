// SINGLE SOURCE OF TRUTH — re-exports the one shared catalog + styling engine
// from apps/web. The storefront widget and the demo now run the IDENTICAL
// color/harmony/fit/sizing/look engine and product data; there is no second
// copy to drift. Image URLs are made absolute for the storefront via the
// build-time __SQ_ASSET_BASE__ define in esbuild.config.mjs (see resolveAsset).
//
// esbuild bundles this cross-directory import directly (the file has no Next or
// server-only deps); react→preact and next/image→shim aliases handle the rest.
export * from "../../../web/app/lib/catalog";
