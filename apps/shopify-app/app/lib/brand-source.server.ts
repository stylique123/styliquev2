// Server-only helpers for the Brand DNA settings route. These live in a
// `.server.ts` module (not in the route file) so Remix hard-excludes them from
// the client bundle. Keeping them inline in app.settings.brand.tsx caused
// Remix's client tree-shaking to fail ("Server-only module referenced by
// client: ../db.server"), which broke the production build → failed the deploy.
import { prisma } from "../db.server";

export async function setBrandSourceStatus(
  shopId: string,
  kind: "INSTAGRAM" | "SHOPIFY",
  data: { status: "PENDING" | "FAILED"; error: string | null },
): Promise<void> {
  const existing = await prisma.brandSource.findFirst({
    where: { shopId, kind },
    select: { id: true },
  });
  if (existing) {
    await prisma.brandSource.update({
      where: { id: existing.id },
      data: {
        status: data.status,
        error: data.error,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.brandSource.create({
      data: {
        shopId,
        kind,
        status: data.status,
        error: data.error,
      },
    });
  }
}

export async function ensureBrandProfile(shopId: string): Promise<string> {
  const existing = await prisma.brandProfile.findUnique({
    where: { shopId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.brandProfile.create({
    data: { shopId },
    select: { id: true },
  });
  return created.id;
}
