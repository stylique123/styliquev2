// Sentiment extraction job — runs the Gemini-powered conversation analysis
// for a shop's unprocessed ShopperSession rows.
//
// Triggered by:
//   • Nightly repeating job (one per active shop) enqueued at app boot
//   • Manual "Extract now" button via POST /api/admin/sentiment/extract

import { prisma, Prisma } from "@stylique/db";

export type SentimentJobData = { shopId: string };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export async function processSentimentExtract(data: SentimentJobData): Promise<void> {
  if (!GEMINI_API_KEY) {
    console.warn("[sentiment] GEMINI_API_KEY not set — skipping");
    return;
  }

  // ShopperSession is scoped by shopifyDomain (no shopId FK) — resolve it.
  // SECURITY: shopId-scoped through the shop lookup.
  const shopRecord = await prisma.shop.findUnique({
    where: { id: data.shopId },
    select: { shopifyDomain: true },
  });
  if (!shopRecord) {
    console.warn("[sentiment] shop not found", data.shopId);
    return;
  }

  // Find sessions with 4+ turns that haven't been analyzed yet
  const sessions = await prisma.shopperSession.findMany({
    where: {
      shopifyDomain: shopRecord.shopifyDomain,
      sentimentExtractedAt: null,
      // Prisma JSON nullability — must use Prisma.DbNull explicitly for
      // "is not null" on a Json? column. Plain `null` is rejected at
      // typecheck because Prisma distinguishes JSON-null from DB-null.
      chatHistoryJson: { not: Prisma.DbNull },
    },
    select: { id: true, chatHistoryJson: true },
    take: 50, // batch per run
  });

  for (const session of sessions) {
    const history = session.chatHistoryJson as Array<{ role: string; text?: string }> | null;
    if (!history || history.length < 4) continue; // skip short sessions

    // Build conversation text (shopper turns only, truncated)
    const shopperText = history
      .filter((m) => m.role === "user")
      .map((m) => m.text ?? "")
      .join(" | ")
      .slice(0, 1200); // cap context

    if (shopperText.length < 20) continue;

    try {
      const result = await callGeminiExtract(shopperText);
      if (result) {
        await prisma.shopperSession.update({
          where: { id: session.id },
          data: {
            sentimentLabel: result.sentiment,
            sentimentThemes: result.themes,
            sentimentSummary: result.summary,
            sentimentFoundItem: result.found,
            sentimentExtractedAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("[sentiment] failed for session", session.id, err);
      // Mark as attempted so we don't retry forever
      await prisma.shopperSession
        .update({
          where: { id: session.id },
          data: { sentimentExtractedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }
}

async function callGeminiExtract(shopperText: string): Promise<{
  sentiment: string;
  themes: string[];
  summary: string;
  found: string;
} | null> {
  const prompt = `You are analyzing a fashion shopping conversation. The shopper said:
"${shopperText}"

Extract:
1. Overall sentiment: positive | neutral | negative
2. Up to 3 theme tags from: ["occasion-shopping","size-uncertainty","color-preference","style-discovery","budget-conscious","gifting","comparing-items","wants-try-on","catalog-gap","quick-decision","returning-shopper"]
3. One-sentence summary of what they were looking for (max 15 words, plain English)
4. Did they seem to find what they wanted? yes | no | partial

Return ONLY valid JSON with no markdown: {"sentiment":"...","themes":[...],"summary":"...","found":"..."}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
      }),
    },
  );

  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  try {
    // Strip markdown code fences that Gemini sometimes wraps around JSON
    // (e.g. ```json\n{...}\n```) — plain JSON.parse fails on those.
    const stripped = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(stripped);
    if (parsed.sentiment && parsed.themes && parsed.summary && parsed.found) {
      return {
        sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment)
          ? parsed.sentiment
          : "neutral",
        themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5) : [],
        summary: String(parsed.summary).slice(0, 100),
        found: ["yes", "no", "partial"].includes(parsed.found) ? parsed.found : "partial",
      };
    }
  } catch {
    /* bad JSON from model */
  }
  return null;
}
