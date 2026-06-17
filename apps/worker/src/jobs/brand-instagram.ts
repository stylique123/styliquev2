// Brand Instagram ZIP processing job (Brand DNA system).
//
// Processes an Instagram data archive (.zip) downloaded by the merchant from
// Instagram → Settings → Your activity → Download your information.
//
// Steps:
//   1. Extract the ZIP to a temp directory (uses system `unzip` shell command)
//   2. Find all image files (JPEG/PNG/WebP), cap at 50
//   3. Call Gemini Vision in batches of 5 to extract visual DNA signals
//   4. Merge signals into BrandDNA
//   5. Update BrandProfile.paletteJson + toneJson
//   6. Clean up temp files
//
// If `data.campaignOverride` is set, the result is stored as a campaign
// override entry inside BrandProfile.toneJson.campaignOverrides[] rather
// than the base DNA — so brands can have one "summer campaign" aesthetic
// that overrides the base DNA for jobs tagged with that campaign name.

import { prisma } from "@stylique/db";
import { extractDNAFromInstagramPosts, mergeBrandDNA } from "@stylique/core";
import { execSync } from "node:child_process";
import { readdir, rm, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export type BrandInstagramJobData = {
  shopId: string;
  zipPath: string;          // local path where the ZIP was saved
  campaignOverride?: string; // if set, creates a campaign override not base DNA
};

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_IMAGES = 50;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

export async function processBrandInstagram(data: BrandInstagramJobData): Promise<void> {
  const { shopId, zipPath, campaignOverride } = data;

  // ─── 0. Validate inputs ──────────────────────────────────────────────────
  if (!existsSync(zipPath)) {
    console.error(`[brand-instagram] ZIP not found: ${zipPath}`);
    await updateBrandSourceStatus(shopId, "FAILED", "zip_not_found");
    return;
  }

  if (!GEMINI_API_KEY) {
    console.error(`[brand-instagram] GEMINI_API_KEY not set — cannot extract DNA`);
    await updateBrandSourceStatus(shopId, "FAILED", "gemini_api_key_missing");
    return;
  }

  // ─── 1. Extract ZIP to temp directory ───────────────────────────────────
  const runId = randomBytes(6).toString("hex");
  const extractDir = join(tmpdir(), `stylique-instagram-${shopId}-${runId}`);

  try {
    await mkdir(extractDir, { recursive: true });
    execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { timeout: 60_000 });
    console.log(`[brand-instagram] Extracted ZIP to ${extractDir}`);
  } catch (err) {
    console.error(`[brand-instagram] ZIP extraction failed`, err);
    await updateBrandSourceStatus(shopId, "FAILED", "zip_extraction_failed");
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  // ─── 2. Find image files ─────────────────────────────────────────────────
  let imagePaths: string[] = [];
  try {
    imagePaths = await findImages(extractDir);
  } catch (err) {
    console.error(`[brand-instagram] Failed to scan extracted directory`, err);
  }

  if (imagePaths.length === 0) {
    console.warn(`[brand-instagram] No images found in ZIP — shop=${shopId}`);
    await updateBrandSourceStatus(shopId, "FAILED", "no_images_in_zip");
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  // Sort by filename (Instagram exports chronologically by filename).
  // Take the MOST RECENT (end of sorted list) up to MAX_IMAGES — recent
  // posts reflect current brand aesthetic better than older ones.
  imagePaths.sort();
  const selected = imagePaths.slice(-MAX_IMAGES);
  console.log(`[brand-instagram] Processing ${selected.length} images (of ${imagePaths.length} found) — shop=${shopId}`);

  // ─── 3. Extract DNA signals via Gemini Vision ────────────────────────────
  let signals: import("@stylique/core").BrandDNASignal[];
  try {
    signals = await extractDNAFromInstagramPosts(selected, GEMINI_API_KEY);
  } catch (err) {
    console.error(`[brand-instagram] DNA extraction failed`, err);
    signals = [];
  }

  if (signals.length === 0) {
    console.warn(`[brand-instagram] No signals extracted — shop=${shopId}`);
    // Don't fail the job — the ZIP was valid, the model just returned nothing usable
  }

  // ─── 4. Merge signals ────────────────────────────────────────────────────
  const dna = mergeBrandDNA(signals);

  // ─── 5. Update BrandProfile ──────────────────────────────────────────────
  const profile = await prisma.brandProfile.findUnique({
    where: { shopId },
    select: { id: true, paletteJson: true, toneJson: true },
  });

  if (!profile) {
    console.error(`[brand-instagram] BrandProfile not found for shop=${shopId}`);
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  if (campaignOverride) {
    // Merge into toneJson.campaignOverrides array
    const existingTone = (profile.toneJson as Record<string, unknown> | null) ?? {};
    const existing = (existingTone.campaignOverrides as unknown[]) ?? [];
    // Deactivate any previous override with the same name
    const filtered = (existing as Array<{ name?: string }>).filter(
      (o) => o.name !== campaignOverride,
    );
    const newOverride = {
      name: campaignOverride,
      active: true,
      ...dna.toneJson,
      palette: dna.paletteJson.hex,
      createdAt: new Date().toISOString(),
    };
    const updatedTone = {
      ...existingTone,
      campaignOverrides: [...filtered, newOverride],
    };
    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: {
        toneJson: updatedTone as object,
        trainedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`[brand-instagram] Saved campaign override "${campaignOverride}" — shop=${shopId}`);
  } else {
    // Merge into base DNA. Instagram signals preferred for mood/lighting/
    // composition since they reflect intentional brand photography. Catalog
    // signals (if any) are kept for fabric/seasonality/positioning data.
    const existingTone = (profile.toneJson as Record<string, unknown> | null) ?? {};
    const mergedTone = {
      ...existingTone,
      // Override with Instagram-derived aesthetics
      moodAdjectives: dna.toneJson.moodAdjectives.length > 0
        ? dna.toneJson.moodAdjectives
        : (existingTone.moodAdjectives as string[] | undefined) ?? [],
      lighting: dna.toneJson.lighting || existingTone.lighting,
      modelArchetype: dna.toneJson.modelArchetype || existingTone.modelArchetype,
      composition: dna.toneJson.composition || existingTone.composition,
      // Keep catalog-derived fields unless Instagram provides them
      dominantFabrics: (existingTone.dominantFabrics as string[] | undefined) ?? [],
      seasonality: (existingTone.seasonality as string | undefined) ?? dna.toneJson.seasonality,
      pricePositioning: (existingTone.pricePositioning as string | undefined) ?? dna.toneJson.pricePositioning,
    };

    // Merge palette: prefer Instagram palette if we have enough colors
    const mergedPalette = dna.paletteJson.hex.length >= 3
      ? dna.paletteJson.hex
      : (profile.paletteJson as { hex?: string[] } | null)?.hex ?? [];

    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: {
        paletteJson: { hex: mergedPalette } as object,
        toneJson: mergedTone as object,
        trainedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`[brand-instagram] Updated base DNA — shop=${shopId} moodAdjectives=${dna.toneJson.moodAdjectives.join(",")}`);
  }

  // Update BrandSource to READY
  await updateBrandSourceStatus(shopId, "READY");

  // ─── 6. Clean up ─────────────────────────────────────────────────────────
  await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  // Keep the original ZIP for potential re-processing; caller removes it if needed
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findImages(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walk(dir, results);
  return results;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        try {
          const s = await stat(fullPath);
          // Skip tiny files (< 5KB) — likely icons/thumbnails
          if (s.size > 5_000) out.push(fullPath);
        } catch {
          // skip
        }
      }
    }
  }
}

async function updateBrandSourceStatus(
  shopId: string,
  status: "READY" | "FAILED",
  error?: string,
): Promise<void> {
  try {
    await prisma.brandSource.updateMany({
      where: { shopId, kind: "INSTAGRAM" },
      data: {
        status,
        lastSyncedAt: status === "READY" ? new Date() : undefined,
        error: error ?? null,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[brand-instagram] Failed to update BrandSource status", err);
  }
}
