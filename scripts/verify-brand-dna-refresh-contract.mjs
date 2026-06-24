#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogSync = readFileSync(resolve(root, "apps/worker/src/jobs/catalog-sync.ts"), "utf8");
const brandDnaJob = readFileSync(resolve(root, "apps/worker/src/jobs/brand-dna-catalog.ts"), "utf8");
const brandSettings = readFileSync(resolve(root, "apps/shopify-app/app/routes/app.settings.brand.tsx"), "utf8");
const brandInstagramJob = readFileSync(resolve(root, "apps/worker/src/jobs/brand-instagram.ts"), "utf8");

const failures = [];

if (!/new Queue\("brand-dna-catalog"/.test(catalogSync) || !/function brandDnaCatalogQueue\(\)/.test(catalogSync)) {
  failures.push("catalog sync must own a brand-dna-catalog queue producer");
}

if (!/async function enqueueBrandDnaRefresh/.test(catalogSync) || !/brandDnaCatalogQueue\(\)\.add\(\s*"extract"/.test(catalogSync)) {
  failures.push("catalog sync must centralize Brand DNA queueing in enqueueBrandDnaRefresh()");
}

const refreshCalls = [...catalogSync.matchAll(/enqueueBrandDnaRefresh\(/g)];
if (refreshCalls.length < 3) {
  failures.push("catalog sync must call Brand DNA refresh from delete, full-sync, and single-product paths");
}

if (!/data\.kind === "delete"[\s\S]{0,260}enqueueBrandDnaRefresh\(data\.shopId, log\)/.test(catalogSync)) {
  failures.push("delete sync must refresh Brand DNA so removed products stop influencing brand taste");
}

if (!/data\.kind === "full"[\s\S]{0,3600}const brandDnaQueued = await enqueueBrandDnaRefresh\(data\.shopId, log\)/.test(catalogSync)) {
  failures.push("full catalog sync must refresh Brand DNA after catalog/image/size follow-up jobs are queued");
}

if (!/const product = await client\.fetchProduct[\s\S]{0,5400}enqueueBrandDnaRefresh\(shop\.id, log\)/.test(catalogSync)) {
  failures.push("single-product webhook sync must refresh Brand DNA after product changes");
}

if (!/brand-dna-after-sync:\$\{shopId\}:\$\{jobBucket\(6 \* 60 \* 60 \* 1000\)\}/.test(catalogSync)) {
  failures.push("Brand DNA sync refresh must use a bounded time-bucketed jobId instead of one-shot or unbounded jobs");
}

if (!/brandDnaQueued\s*=\s*await enqueueBrandDnaRefresh/.test(catalogSync) || /brandDnaQueued:\s*true/.test(catalogSync)) {
  failures.push("catalog sync completion notification/log payload must report actual Brand DNA enqueue success, not a hard-coded true");
}

if (!/markShopifyBrandDnaSource\(shopId,\s*\{\s*status:\s*"PENDING"/.test(catalogSync)) {
  failures.push("successful catalog-triggered Brand DNA enqueue must mark the Shopify BrandSource as PENDING");
}

if (!/markShopifyBrandDnaSource\(shopId,\s*\{\s*status:\s*"FAILED"/.test(catalogSync)) {
  failures.push("failed catalog-triggered Brand DNA enqueue must mark the Shopify BrandSource as FAILED");
}

if (!/intent === "refresh_catalog"[\s\S]{0,500}setBrandSourceStatus\(shop\.id,\s*"SHOPIFY",\s*\{\s*status:\s*"PENDING"/.test(brandSettings)) {
  failures.push("manual Brand DNA refresh must mark the Shopify BrandSource as PENDING before enqueue");
}

if (!/catch \(err\)[\s\S]{0,360}setBrandSourceStatus\(shop\.id,\s*"SHOPIFY",\s*\{\s*status:\s*"FAILED"/.test(brandSettings)) {
  failures.push("manual Brand DNA refresh must mark the Shopify BrandSource as FAILED when enqueue fails");
}

if (!/return json\(\{ error: "Could not queue catalog DNA refresh/.test(brandSettings)) {
  failures.push("manual Brand DNA refresh must surface enqueue failure to the merchant instead of redirecting success");
}

if (/instagramQueue\(\)\.add\([\s\S]{0,360}\)\.catch\(/.test(brandSettings)) {
  failures.push("Instagram/campaign DNA queueing must not swallow enqueue failures with .catch()");
}

if (!/intent === "upload_instagram"[\s\S]{0,1700}setBrandSourceStatus\(shop\.id,\s*"INSTAGRAM",\s*\{\s*status:\s*"PENDING"/.test(brandSettings)) {
  failures.push("Instagram archive upload must mark the Instagram BrandSource as PENDING before enqueue");
}

if (!/Failed to enqueue brand-instagram job[\s\S]{0,260}setBrandSourceStatus\(shop\.id,\s*"INSTAGRAM",\s*\{\s*status:\s*"FAILED"/.test(brandSettings)) {
  failures.push("Instagram archive upload must mark the Instagram BrandSource as FAILED when enqueue fails");
}

if (!/return json\(\{ error: "Could not queue Instagram DNA processing/.test(brandSettings)) {
  failures.push("Instagram archive upload must surface enqueue failure to the merchant instead of redirecting success");
}

if (!/intent === "campaign_override_images"[\s\S]{0,1300}setBrandSourceStatus\(shop\.id,\s*"INSTAGRAM",\s*\{\s*status:\s*"PENDING"/.test(brandSettings)) {
  failures.push("campaign override upload must mark the Instagram BrandSource as PENDING before enqueue");
}

if (!/Failed to enqueue campaign override job[\s\S]{0,260}setBrandSourceStatus\(shop\.id,\s*"INSTAGRAM",\s*\{\s*status:\s*"FAILED"/.test(brandSettings)) {
  failures.push("campaign override upload must mark the Instagram BrandSource as FAILED when enqueue fails");
}

if (!/return json\(\{ error: "Could not queue campaign DNA processing/.test(brandSettings)) {
  failures.push("campaign override upload must surface enqueue failure to the merchant instead of redirecting success");
}

if (!/BrandProfile not found[\s\S]{0,220}updateBrandSourceStatus\(shopId,\s*"FAILED",\s*"brand_profile_missing"\)/.test(brandInstagramJob)) {
  failures.push("Brand Instagram worker must mark the source FAILED when a BrandProfile is missing");
}

if (!/Triggered automatically after (?:first )?catalog sync/.test(brandDnaJob)) {
  failures.push("brand-dna job documentation must continue to describe catalog-sync as an automatic trigger");
}

if (failures.length > 0) {
  console.error("Brand DNA refresh contract drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("brand DNA refresh contract verifier passed");
