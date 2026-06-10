/**
 * Mira Self-Improving Behavioral Training Loop
 * ─────────────────────────────────────────────
 * A recursive simulation → evaluation → failure-detection → root-cause →
 * fix-proposal → memory-write → re-test cycle that evolves Mira's behavior
 * over time through data, not intuition.
 *
 * Run:  node apps/web/scripts/mira-self-training.mjs
 * Args: --cycles 3   (how many retrain loops to run, default 1)
 *       --scenarios 30 (how many per cycle, default 30)
 *       --apply       (auto-write improvement proposals to memory)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const MEMORY_PATH = join(DATA_DIR, "mira-behavioral-memory.json");
const REPORT_PATH = join(DATA_DIR, "mira-training-report.json");
const HISTORY_PATH = join(DATA_DIR, "mira-training-history.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const API = "http://localhost:3000/api/mira";
const args = process.argv.slice(2);
const idxC = args.indexOf("--cycles");
const idxS = args.indexOf("--scenarios");
const CYCLES = idxC >= 0 ? Number(args[idxC + 1] ?? 1) : 1;
const SCENARIO_COUNT = idxS >= 0 ? Number(args[idxS + 1] ?? 30) : 30;
const AUTO_APPLY = args.includes("--apply");

// ── Catalog (must mirror apps/web/app/lib/catalog.ts) ────────────────────────
const CATALOG = [
  { handle: "onyx-silk-slip",          name: "Onyx Silk Slip",                   category: "dress",     priceUsd: 690,  colors: ["Onyx","Ivory"],            sizes: ["XS","S","M","L"] },
  { handle: "ivory-silk-camisole",     name: "Ivory Silk Camisole",              category: "top",       priceUsd: 320,  colors: ["Ivory","Onyx"],            sizes: ["XS","S","M","L"] },
  { handle: "atelier-wide-leg-trouser",name: "Atelier Wide-Leg Trouser",         category: "bottom",    priceUsd: 540,  colors: ["Charcoal","Camel","Ink"],  sizes: ["XS","S","M","L","XL"] },
  { handle: "linen-relaxed-shirt",     name: "Linen Relaxed Shirt",              category: "top",       priceUsd: 280,  colors: ["Bone","Stone","Black"],     sizes: ["XS","S","M","L","XL"] },
  { handle: "wrap-coat-camel",         name: "Camel Wrap Coat",                  category: "outerwear", priceUsd: 1280, colors: ["Camel","Charcoal"],        sizes: ["XS","S","M","L"] },
  { handle: "cashmere-v-neck",         name: "Cashmere V-Neck",                  category: "knitwear",  priceUsd: 420,  colors: ["Oat","Black","Cardinal"],  sizes: ["XS","S","M","L"] },
  { handle: "midnight-silk-gown",      name: "Midnight Silk Gown",               category: "dress",     priceUsd: 1450, colors: ["Midnight"],                sizes: ["XS","S","M","L"] },
  { handle: "tailored-blazer-double",  name: "Tailored Double-Breasted Blazer",  category: "outerwear", priceUsd: 890,  colors: ["Charcoal","Ink"],          sizes: ["XS","S","M","L","XL"] },
  { handle: "pleated-midi-skirt",      name: "Pleated Satin Midi Skirt",         category: "bottom",    priceUsd: 480,  colors: ["Champagne","Black"],       sizes: ["XS","S","M","L"] },
  { handle: "merino-ribbed-turtleneck",name: "Merino Ribbed Turtleneck",         category: "knitwear",  priceUsd: 290,  colors: ["Bone","Black","Espresso"], sizes: ["XS","S","M","L"] },
  { handle: "leather-trench",          name: "Leather Trench",                   category: "outerwear", priceUsd: 2400, colors: ["Cognac","Black"],          sizes: ["XS","S","M","L"] },
  { handle: "wide-leg-denim",          name: "Wide-Leg Heritage Denim",          category: "bottom",    priceUsd: 320,  colors: ["Indigo","Black"],          sizes: ["24","26","28","30","32"] },
];
const VALID_HANDLES = new Set(CATALOG.map((p) => p.handle));

// ── Failure classification taxonomy ──────────────────────────────────────────
const FAILURE_TYPES = {
  HALLUCINATION:       "hallucination",         // invented product handle
  PDP_BLIND:           "pdp_context_blind",      // ignored current product on PDP
  ANSWER_DEFLECTION:   "answer_before_qualify",  // deflected question with question
  COLOR_IMPRECISION:   "color_precision",        // called adjacent color exact
  COMPARISON_DODGE:    "comparison_dodge",       // refused to pick in comparison
  WRONG_ROUTE:         "wrong_route",            // route doesn't match intent
  MISSING_UNMET:       "missing_unmet_flag",     // catalog gap not flagged
  MISSING_NEAR_MISS:   "missing_near_miss_flag", // near-miss not flagged
  PREMATURE_CLOSE:     "premature_close",        // pushed cart before trust
  LATE_CLOSE:          "late_close",             // didn't close when ready
  BODY_MEMORY_MISS:    "body_memory_miss",       // re-asked for measurements
  WEAK_HESITATION:     "weak_hesitation_read",   // didn't catch hesitation signal
  GENERIC_VOICE:       "generic_voice",          // sounded like a chatbot
  MISSING_INTENT:      "missing_intent_field",   // intent not set
  INTERRUPTION:        "poor_interruption",      // proactive trigger too early
  TRUST_MISS:          "trust_recovery_miss",    // failed to reassure trust-low
  OVERWHELM_MISS:      "overwhelm_miss",         // didn't simplify for overwhelmed
  OUTFIT_WRONG_ROUTE:  "outfit_wrong_route",     // used reco_handle for look request
};

// ── Shopper archetype library ─────────────────────────────────────────────────
// Each archetype defines who this person is, what signals they emit,
// and what Mira's ideal response should look like.
const SHOPPER_ARCHETYPES = [
  {
    type: "casual_browser",
    description: "Casually scrolling, low commitment, no clear goal",
    state: "browsing",
    pageTypes: ["homepage", "collection"],
    messages: [
      "just looking around",
      "what do you have?",
      "show me something nice",
      "I dunno, just browsing",
      "nothing specific, just seeing what's here",
    ],
    expectedBehavior: "warm redirect with ONE qualifying question, no product dump",
    forbiddenBehaviors: ["dump products immediately", "generic 'how can I help'"],
    expectedRoute: "talk_only",
    expectedIntent: "discover",
  },
  {
    type: "focused_pdp_visitor",
    description: "On a product page, clearly interested, might buy",
    state: "focused_intent",
    pageTypes: ["pdp"],
    messages: [
      "hi",
      "tell me about this",
      "is this worth it?",
      "can I see how this fits?",
      "what do people think of this?",
    ],
    expectedBehavior: "reference the specific product immediately, offer next action",
    forbiddenBehaviors: ["generic greeting ignoring the product", "asking what they're shopping for"],
    expectedRoute: "talk_only",
    expectedIntent: "specific",
    requiresProductHandle: true,
  },
  {
    type: "hesitant_shopper",
    description: "Interested but not confident, looking for reassurance",
    state: "hesitating",
    pageTypes: ["pdp"],
    messages: [
      "I keep coming back to this but I'm not sure",
      "I like it but I don't know if I should get it",
      "it looks good but I'm not convinced",
      "what if it doesn't look good on me?",
      "I've been going back and forth on this",
    ],
    expectedBehavior: "ask what's holding them back, offer reassurance, NOT push to cart",
    forbiddenBehaviors: ["immediately push add_to_cart", "ignore hesitation signal"],
    expectedRoute: "talk_only",
    expectedIntent: "suitability",
    requiresProductHandle: true,
  },
  {
    type: "outfit_seeker",
    description: "Has one piece, wants to build a complete look",
    state: "outfit_seeking",
    pageTypes: ["pdp", "cart"],
    messages: [
      "what goes with this?",
      "how do I wear this?",
      "build me a look around this",
      "complete the outfit",
      "what should I pair with this?",
      "I need the whole look",
    ],
    expectedBehavior: "build a specific look (look route), not random recommendations",
    forbiddenBehaviors: ["show similar products", "reco_category without look"],
    expectedRoute: "look",
    expectedIntent: "look",
    requiresProductHandle: true,
  },
  {
    type: "size_uncertain",
    description: "Wants to buy but unsure about sizing",
    state: "hesitating",
    pageTypes: ["pdp"],
    messages: [
      "what size should I get?",
      "I'm usually a medium, will that work?",
      "I'm between small and medium",
      "does this run small or large?",
      "will this be loose or tight?",
    ],
    expectedBehavior: "route to size_form, acknowledge stated size if given",
    forbiddenBehaviors: ["re-ask for size when already stated", "ignore stated size"],
    expectedRoute: "size_form",
    expectedIntent: "size",
    requiresProductHandle: true,
  },
  {
    type: "price_sensitive",
    description: "Budget-conscious, value-aware",
    state: "price_sensitive",
    pageTypes: ["homepage", "collection", "pdp"],
    messages: [
      "this is too expensive",
      "do you have anything cheaper?",
      "what's your most affordable piece?",
      "I want something under $300",
      "$1200 for a coat? really?",
    ],
    expectedBehavior: "honest about price floor, show closest value, defend quality briefly",
    forbiddenBehaviors: ["immediately capitulate", "ignore the price objection", "pretend cheaper exists"],
    expectedRoute: "reco_filter",
    expectedIntent: "price",
  },
  {
    type: "comparison_shopper",
    description: "Comparing two specific products, wants a clear recommendation",
    state: "focused_intent",
    pageTypes: ["pdp", "homepage"],
    messages: [
      "which is better, the slip or the gown?",
      "should I get the coat or the blazer?",
      "the cashmere or the merino — which do I pick?",
      "I'm torn between two options",
      "compare these two for me",
    ],
    expectedBehavior: "pick one confidently, give one reason, then qualify",
    forbiddenBehaviors: ["refuse to choose", "ask another question without picking"],
    expectedRoute: "talk_only",
    expectedIntent: "discover",
  },
  {
    type: "trust_low",
    description: "Skeptical, has been disappointed before, needs proof",
    state: "trust_low",
    pageTypes: ["pdp"],
    messages: [
      "is this actually good quality or just expensive?",
      "will this actually look good on a normal person?",
      "I've bought expensive things that looked bad, why is this different?",
      "how do I know this is worth it?",
      "is this just hype?",
    ],
    expectedBehavior: "answer directly with specific quality proof, not generic reassurance",
    forbiddenBehaviors: ["vague reassurance", "ignore the trust signal", "immediately push to buy"],
    expectedRoute: "suitability",
    expectedIntent: "suitability",
    requiresProductHandle: true,
  },
  {
    type: "overwhelmed_shopper",
    description: "Seen too much, can't decide, paralyzed by choice",
    state: "overwhelmed",
    pageTypes: ["collection", "homepage"],
    messages: [
      "I've looked at everything and I can't decide",
      "there's too much, I don't know where to start",
      "just pick something for me",
      "I've been scrolling forever and nothing is clicking",
      "I give up, help me",
    ],
    expectedBehavior: "simplify dramatically, offer to narrow to ONE thing, reduce options",
    forbiddenBehaviors: ["show more products", "dump a category", "ask multiple questions"],
    expectedRoute: "talk_only",
    expectedIntent: "discover",
  },
  {
    type: "luxury_shopper",
    description: "High budget, style-conscious, expects sophistication",
    state: "style_conscious",
    pageTypes: ["pdp", "collection"],
    messages: [
      "I want something that reads as genuinely expensive",
      "what's the most premium piece you have?",
      "I don't care about price, I care about quality",
      "something for a gala, money is not an issue",
      "I only buy things that last forever",
    ],
    expectedBehavior: "high-confidence recommendation, reference specific quality details",
    forbiddenBehaviors: ["show cheapest filter", "apologize for prices", "vague fashion language"],
    expectedRoute: "reco_filter",
    expectedIntent: "occasion",
  },
  {
    type: "catalog_gap_seeker",
    description: "Wants something specific that isn't in catalog",
    state: "browsing",
    pageTypes: ["homepage", "collection"],
    messages: [
      "do you have any boots?",
      "I'm looking for a leather mini skirt",
      "show me navy blue trousers",
      "do you have anything in olive green?",
      "I need wide leg linen trousers in cream",
    ],
    expectedBehavior: "honest gap acknowledgment with unmet flag, redirect warmly",
    forbiddenBehaviors: ["invent a product", "show wrong product without acknowledging gap"],
    expectedRoute: "talk_only",
    expectedUnmet: true,
  },
  {
    type: "near_miss_seeker",
    description: "Wants a close variant we almost stock",
    state: "browsing",
    pageTypes: ["pdp", "collection"],
    messages: [
      "do you have this but cropped?",
      "I want this in burgundy",
      "do you have this in beige?",
      "same shirt but long-sleeved?",
      "this but in a smaller print?",
    ],
    expectedBehavior: "serve closest match with nearMiss flag, be explicit about what's missing",
    forbiddenBehaviors: ["say 'yes' for an adjacent product", "pretend the exact variant exists"],
    expectedNearMiss: true,
  },
  {
    type: "decision_ready",
    description: "Ready to buy, just needs the final nudge",
    state: "decision_ready",
    pageTypes: ["pdp"],
    messages: [
      "ok I think I want this",
      "I'll take it",
      "I love it, add it to my bag",
      "yes, this is the one",
      "fine, I'm getting it",
    ],
    expectedBehavior: "add to cart immediately, offer to complete the look",
    forbiddenBehaviors: ["ask more questions", "hesitate", "show alternative products"],
    expectedRoute: "add_to_cart",
    expectedIntent: "specific",
    requiresProductHandle: true,
  },
  {
    type: "emotional_shopper",
    description: "Shopping for emotional reasons — event, validation, mood",
    state: "focused_intent",
    pageTypes: ["homepage", "pdp"],
    messages: [
      "I have a big interview next week and I need to look incredible",
      "my ex is going to be at this party and I need to look amazing",
      "I just got promoted and want to treat myself",
      "I need something that makes me feel powerful",
      "I have a first date and I'm nervous about what to wear",
    ],
    expectedBehavior: "understand the emotional context, recommend with confidence for that exact moment",
    forbiddenBehaviors: ["ignore the emotional context", "generic recommendation", "ask about price"],
    expectedRoute: "reco_handle",
    expectedIntent: "occasion",
  },
  {
    type: "returning_shopper",
    description: "Has bought before, knows the brand, has specific needs",
    state: "focused_intent",
    pageTypes: ["pdp"],
    messages: [
      "I bought the linen shirt before and loved it, what's similar?",
      "I have the trouser already, what else goes with it?",
      "I want to add to my existing wardrobe from here",
    ],
    expectedBehavior: "acknowledge prior purchase context, recommend complementary pieces",
    forbiddenBehaviors: ["ignore the history", "recommend what they already said they have"],
    expectedRoute: "look",
    expectedIntent: "look",
  },
  {
    type: "vague_emotional",
    description: "Vague intent, needs discovery help",
    state: "browsing",
    pageTypes: ["homepage"],
    messages: [
      "I just want something beautiful",
      "I don't know what I want but I'll know it when I see it",
      "surprise me",
      "I want to feel different",
      "I want something that changes how I walk into a room",
    ],
    expectedBehavior: "ONE qualifying question about occasion or feeling, not product dump",
    forbiddenBehaviors: ["dump products immediately", "ask multiple questions at once"],
    expectedRoute: "talk_only",
    expectedIntent: "discover",
  },
];

// ── Scenario generator ─────────────────────────────────────────────────────────
function generateScenario(archetype, index) {
  const message = archetype.messages[index % archetype.messages.length];
  const pageType = archetype.pageTypes[index % archetype.pageTypes.length];

  let currentProductHandle = null;
  if (archetype.requiresProductHandle || pageType === "pdp") {
    // Pick a relevant product based on what the message is about
    const pdpProducts = CATALOG.filter(p =>
      p.category !== "accessory" && (
        pageType === "pdp" ||
        (archetype.type === "outfit_seeker") ||
        (archetype.type === "size_uncertain") ||
        (archetype.type === "hesitant_shopper") ||
        (archetype.type === "trust_low") ||
        (archetype.type === "decision_ready")
      )
    );
    currentProductHandle = pdpProducts[index % pdpProducts.length].handle;
  }

  // Build realistic history for multi-turn scenarios
  const history = [];
  if (archetype.type === "returning_shopper") {
    history.push({ from: "mira", text: "Hi, welcome back." });
    history.push({ from: "user", text: "I bought the linen shirt last month." });
    history.push({ from: "mira", text: "Great — the linen shirt is one of our best pieces. How did it fit?" });
  }
  if (archetype.state === "hesitating" && index > archetype.messages.length / 2) {
    history.push({ from: "mira", text: `I can see you're considering ${currentProductHandle ? CATALOG.find(p=>p.handle===currentProductHandle)?.name : "this piece"}.` });
  }
  if (archetype.type === "size_uncertain" && message.includes("medium")) {
    // Test body memory: user already gave size, Mira should use it
    history.push({ from: "user", text: "I am 5 foot 7 and 70kg" });
    history.push({ from: "mira", text: "Got it. Based on those measurements you'd be a Medium in most of our pieces." });
  }

  return {
    id: `${archetype.type}_${index}`,
    shopperType: archetype.type,
    shopperState: archetype.state,
    pageType,
    currentProductHandle,
    message,
    history,
    archetype,
  };
}

// ── API caller ─────────────────────────────────────────────────────────────────
async function callMira(scenario) {
  try {
    const body = {
      message: scenario.message,
      currentProductHandle: scenario.currentProductHandle,
      history: scenario.history,
      shownHandles: [],
    };
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.decision ?? null;
  } catch {
    return null;
  }
}

// ── Evaluation rubric ──────────────────────────────────────────────────────────
function evaluateResponse(scenario, decision) {
  const failures = [];
  const warnings = [];
  const successes = [];
  const { archetype } = scenario;

  if (!decision) {
    // Timeout / Gemini overload — score as 5 (neutral) so API availability doesn't
    // penalize behavioral scores. Track separately so the report surfaces the volume.
    warnings.push("API fallback / timeout — Gemini overloaded, not a behavioral failure");
    return { failures, warnings, successes, scores: { stylist: 5, emotional: 5, sales: 5, intelligence: 5, overall: 5 } };
  }

  const voice = decision.voice ?? "";
  const route = decision.route ?? "";
  const handle = decision.productHandle;
  const intent = decision.intent;

  // ── HALLUCINATION CHECK ──────────────────────────────────────────────────────
  if (handle && !VALID_HANDLES.has(handle)) {
    failures.push({
      type: FAILURE_TYPES.HALLUCINATION,
      detail: `Invented product handle: "${handle}"`,
      rootCause: "model drifted outside catalog",
      fix: "validateHandle() should have caught this — check post-processing in route.ts",
    });
  } else if (handle && VALID_HANDLES.has(handle)) {
    successes.push("Valid catalog handle returned");
  }

  // ── PDP CONTEXT BLIND CHECK ─────────────────────────────────────────────────
  if (scenario.currentProductHandle && scenario.history.length === 0) {
    const productName = CATALOG.find(p => p.handle === scenario.currentProductHandle)?.name ?? "";
    const genericGreetings = ["what are you shopping for", "how can i help", "what are you looking for", "what brings you", "how may i assist"];
    const isGeneric = genericGreetings.some(g => voice.toLowerCase().includes(g));
    const referencesProduct = productName.split(" ").some(w => w.length > 3 && voice.toLowerCase().includes(w.toLowerCase()));
    if (isGeneric && !referencesProduct) {
      failures.push({
        type: FAILURE_TYPES.PDP_BLIND,
        detail: `On ${scenario.currentProductHandle} PDP but voice is generic greeting: "${voice.slice(0,80)}"`,
        rootCause: "buildPrompt cold-open flag not reaching model",
        fix: "Strengthen ⚠ PDP COLD OPEN instruction in buildPrompt() — add more forbidden examples",
      });
    } else if (referencesProduct) {
      successes.push(`PDP context correctly referenced: "${productName}"`);
    }
  }

  // ── ANSWER-FIRST CHECK ───────────────────────────────────────────────────────
  const isDirectQuestion = /^(is|does|will|should|can|are|do|was|has|have|would|could|did)\b.+\??\s*$/i.test(scenario.message.trim());
  if (isDirectQuestion) {
    const voiceLower = voice.toLowerCase().trimStart();
    const answersFirst = /^(yes|no|honestly|it'?s|that'?s|absolutely|definitely|not|the |this |it |they )/i.test(voiceLower);
    const deflectsFirst = /^(what|where|when|who|how|tell me|depends|that depends)/i.test(voiceLower);
    if (deflectsFirst && !answersFirst) {
      failures.push({
        type: FAILURE_TYPES.ANSWER_DEFLECTION,
        detail: `Direct question "${scenario.message}" got deflection: "${voice.slice(0,80)}"`,
        rootCause: "ANSWER FIRST rule not followed — model asked before answering",
        fix: 'Add explicit few-shot: Question "Is this good?" → "Yes — [reason]. Then qualify."',
      });
    } else if (answersFirst) {
      successes.push("Answer-first rule followed correctly");
    }
  }

  // ── COLOR PRECISION CHECK ────────────────────────────────────────────────────
  const colorAdjacencyQueries = { beige: "Camel", cream: "Ivory", "off-white": "Bone", navy: "Ink", olive: null, burgundy: null };
  for (const [query, actual] of Object.entries(colorAdjacencyQueries)) {
    if (scenario.message.toLowerCase().includes(query)) {
      const saysYes = /^(yes|absolutely|definitely|we have|i have|of course)/i.test(voice.trimStart());
      const acknowledgesAdjacency = voice.toLowerCase().includes("not " + query) || voice.toLowerCase().includes("closest") || voice.toLowerCase().includes("similar");
      if (saysYes && !acknowledgesAdjacency) {
        failures.push({
          type: FAILURE_TYPES.COLOR_IMPRECISION,
          detail: `Shopper asked for "${query}", Mira said yes without qualifying: "${voice.slice(0,80)}"`,
          rootCause: "COLOR PRECISION rule not applied — adjacent color called exact",
          fix: `Add to COLOR_ADJACENCY prompt example: "${query} → Not ${query} exactly, the closest is ${actual ?? 'not in catalog'}"`,
        });
      } else if (acknowledgesAdjacency) {
        successes.push(`Color precision correctly handled: "${query}" acknowledged as adjacent`);
      }
    }
  }

  // ── COMPARISON DODGE CHECK ───────────────────────────────────────────────────
  if (/torn between|vs|versus|or the|which (is better|should|do i|one)/i.test(scenario.message) && route === "talk_only") {
    const hasOpinion = /(the .+ is|i('d| would) (go|pick|choose|recommend)|personally|honestly, the)/i.test(voice);
    const deflectsOnly = /what('s| is) the occasion|what are you|tell me more|depends/i.test(voice) && !hasOpinion;
    if (deflectsOnly) {
      failures.push({
        type: FAILURE_TYPES.COMPARISON_DODGE,
        detail: `Comparison question got deflection without picking: "${voice.slice(0,80)}"`,
        rootCause: "COMPARISON rule not followed — asked qualifying question without giving an opinion",
        fix: "Add few-shot: comparison → pick first, reason, then qualify. Never deflect only.",
      });
    } else if (hasOpinion) {
      successes.push("Comparison handled with a confident opinion");
    }
  }

  // ── ROUTE ACCURACY CHECK ─────────────────────────────────────────────────────
  if (archetype.expectedRoute && route !== archetype.expectedRoute) {
    // Acceptable alternatives — many routes are functionally equivalent or better.
    // The evaluator should not penalise these substitutions.
    const acceptableAlternatives = {
      look:         ["reco_handle", "navigate"],   // reco_handle/navigate take shopper to product
      size_form:    ["fit", "talk_only", "suitability"],
      talk_only:    ["suitability", "reco_handle", "reco_filter"], // proactive pick for overwhelmed = correct
      add_to_cart:  ["navigate", "reco_handle"],
      reco_filter:  ["reco_handle", "navigate", "suitability"],    // luxury pick by handle is fine
      reco_handle:  ["navigate", "reco_filter", "talk_only"],      // talk_only with one pick is valid
      navigate:     ["reco_handle", "reco_filter"],                // functionally identical
    };
    const isAcceptable = (acceptableAlternatives[archetype.expectedRoute] ?? []).includes(route);
    if (!isAcceptable) {
      failures.push({
        type: FAILURE_TYPES.WRONG_ROUTE,
        detail: `Expected "${archetype.expectedRoute}", got "${route}"`,
        rootCause: "route selection logic mismatch",
        fix: `Add to ROUTE SELECTION prompt: "${scenario.message.slice(0,40)}" → ${archetype.expectedRoute}`,
      });
    } else {
      warnings.push(`Route "${route}" is acceptable alternative to "${archetype.expectedRoute}"`);
    }
  } else if (archetype.expectedRoute && route === archetype.expectedRoute) {
    successes.push(`Correct route: ${route}`);
  }

  // ── UNMET DEMAND CHECK ───────────────────────────────────────────────────────
  if (archetype.expectedUnmet && !decision.unmet) {
    failures.push({
      type: FAILURE_TYPES.MISSING_UNMET,
      detail: `Catalog gap scenario but unmet flag not set`,
      rootCause: "CATALOG GAPS prompt not triggering for this message pattern",
      fix: `Add to gap examples in system prompt: "${scenario.message.slice(0,50)}"`,
    });
  } else if (archetype.expectedUnmet && decision.unmet) {
    successes.push("Catalog gap correctly flagged with unmet=true");
  }

  // ── NEAR-MISS CHECK ──────────────────────────────────────────────────────────
  if (archetype.expectedNearMiss && !decision.nearMiss) {
    failures.push({
      type: FAILURE_TYPES.MISSING_NEAR_MISS,
      detail: `Near-miss scenario but nearMiss flag not set`,
      rootCause: "NEAR-MISS prompt not triggering for this message pattern",
      fix: `Add near-miss example: "${scenario.message.slice(0,50)}" → nearMiss=true + nearMissAttribute`,
    });
  } else if (archetype.expectedNearMiss && decision.nearMiss) {
    successes.push(`Near-miss correctly flagged: attribute="${decision.nearMissAttribute}"`);
  }

  // ── INTENT FIELD CHECK ───────────────────────────────────────────────────────
  if (!intent) {
    warnings.push("intent field not set — merchant intent histogram incomplete");
  } else {
    successes.push(`Intent correctly classified: ${intent}`);
  }

  // ── VOICE QUALITY CHECK ─────────────────────────────────────────────────────
  const bannedWords = ["substantial", "curated", "elevated", "timeless", "effortless", "investment piece", "great choice", "hope that helps", "how can i help", "let me know if"];
  const hasBanned = bannedWords.some(w => voice.toLowerCase().includes(w));
  if (hasBanned) {
    const found = bannedWords.filter(w => voice.toLowerCase().includes(w));
    failures.push({
      type: FAILURE_TYPES.GENERIC_VOICE,
      detail: `Banned vocabulary in voice: ${found.join(", ")}`,
      rootCause: "HOW TO TALK rules not followed",
      fix: "Add to BANNED words list in buildSystem()",
    });
  }
  if (voice.length > 200) {
    warnings.push(`Voice too long: ${voice.length} chars. Target: <120.`);
  }

  // ── SCORING ──────────────────────────────────────────────────────────────────
  const failureCount = failures.length;
  const warningCount = warnings.length;
  const successCount = successes.length;

  const stylist = Math.max(0, Math.min(10, 10 - (failureCount * 2.5) - (warningCount * 0.5)));
  const emotional = archetype.state === "hesitating" || archetype.state === "trust_low"
    ? failures.some(f => f.type === FAILURE_TYPES.WEAK_HESITATION || f.type === FAILURE_TYPES.TRUST_MISS) ? 3 : 8
    : 7;
  const sales = archetype.state === "decision_ready"
    ? route === "add_to_cart" ? 10 : failures.some(f => f.type === FAILURE_TYPES.LATE_CLOSE) ? 3 : 6
    : Math.max(0, 7 - failureCount);
  // Precedence-corrected: was `intent ? 7 : 3 + bonuses` which parsed as
  // `intent ? 7 : (3 + bonuses)` — the unmet/nearMiss bonuses applied ONLY
  // when intent was missing, exact opposite of intent. Now: base 3 always,
  // +4 for valid intent, +2 each for honest gap/near-miss signals (max 11
  // raw, normalized below so missing 3 behaviors can never read as 10).
  const intelligenceRaw =
    3 +
    (decision.intent ? 4 : 0) +
    (decision.unmet ? 2 : 0) +
    (decision.nearMiss ? 2 : 0);
  const intelligence = Math.round((intelligenceRaw / 11) * 10 * 10) / 10;

  const overall = Math.round((stylist * 0.3 + emotional * 0.2 + sales * 0.3 + intelligence * 0.2) * 10) / 10;

  return { failures, warnings, successes, scores: { stylist, emotional, sales, intelligence, overall } };
}

// ── Self-critique engine ───────────────────────────────────────────────────────
function selfCritique(scenario, decision, evaluation) {
  const voice = decision?.voice ?? "";
  const route = decision?.route ?? "";
  const critique = {
    understoodShopper: null,
    respondedNaturally: null,
    reducedUncertainty: null,
    guidedIntelligently: null,
    askedRightQuestion: null,
    missedHesitation: null,
    closedCorrectly: null,
    usedRightTool: null,
    emittedEvents: null,
    improvedMerchantIntelligence: null,
    feltHuman: null,
    hiddenFutureFailures: [],
  };

  // 1. Did Mira understand the shopper?
  critique.understoodShopper = evaluation.failures.filter(f => f.type === FAILURE_TYPES.PDP_BLIND || f.type === FAILURE_TYPES.GENERIC_VOICE).length === 0;

  // 2. Did Mira respond naturally?
  critique.respondedNaturally = !evaluation.failures.some(f => f.type === FAILURE_TYPES.GENERIC_VOICE) && voice.length < 180;

  // 3. Did Mira reduce uncertainty?
  critique.reducedUncertainty = evaluation.failures.filter(f =>
    f.type === FAILURE_TYPES.ANSWER_DEFLECTION || f.type === FAILURE_TYPES.COMPARISON_DODGE
  ).length === 0;

  // 4. Did Mira guide intelligently?
  critique.guidedIntelligently = evaluation.failures.filter(f =>
    f.type === FAILURE_TYPES.WRONG_ROUTE || f.type === FAILURE_TYPES.OUTFIT_WRONG_ROUTE
  ).length === 0;

  // 5. Did Mira ask the right question?
  const asksQuestion = voice.includes("?");
  const asksOneQuestion = (voice.match(/\?/g) ?? []).length <= 1;
  critique.askedRightQuestion = asksOneQuestion; // one question max

  // 6. Did Mira miss hesitation?
  critique.missedHesitation = scenario.archetype.state === "hesitating"
    && route === "add_to_cart"
    && !scenario.history.some(h => h.from === "mira" && /what('s| is) holding/i.test(h.text));

  // 7. Did Mira close correctly?
  critique.closedCorrectly = scenario.archetype.state === "decision_ready"
    ? route === "add_to_cart"
    : true;

  // 8. Did Mira use the right tool?
  critique.usedRightTool = evaluation.failures.filter(f => f.type === FAILURE_TYPES.WRONG_ROUTE).length === 0;

  // 9. Event coverage
  critique.emittedEvents = decision?.intent != null;

  // 10. Merchant intelligence
  critique.improvedMerchantIntelligence = !!(decision?.intent && (
    decision?.unmet || decision?.nearMiss || decision?.productHandle
  ));

  // 11. Felt human
  const roboticPatterns = ["i am here to help", "as an ai", "i don't have", "unfortunately i cannot"];
  critique.feltHuman = !roboticPatterns.some(p => voice.toLowerCase().includes(p));

  // ── Hidden future failure prediction ─────────────────────────────────────────
  // Think forward: what could go wrong in similar situations that hasn't been caught yet?

  if (scenario.archetype.type === "luxury_shopper") {
    critique.hiddenFutureFailures.push({
      risk: "Cultural luxury signaling may fail for non-Western luxury shoppers",
      likelihood: 0.4,
      mitigation: "Add cultural context awareness to luxury shopper handling — 'premium' means different things in different markets",
    });
  }
  if (scenario.archetype.type === "comparison_shopper") {
    critique.hiddenFutureFailures.push({
      risk: "Mira may become repetitive if shopper compares more than 3 times — recommendation loop",
      likelihood: 0.6,
      mitigation: "Add counter: after 2 comparisons in one session, offer to narrow by a concrete criterion instead of picking again",
    });
  }
  if (scenario.archetype.type === "hesitant_shopper") {
    critique.hiddenFutureFailures.push({
      risk: "Hesitation recovery may trigger try-on too early before the hesitation reason is known",
      likelihood: 0.5,
      mitigation: "Gate try-on offer: first ask 'what's holding you back?' — only offer try-on if answer is about appearance",
    });
  }
  if (scenario.archetype.type === "outfit_seeker" && !scenario.history.length) {
    critique.hiddenFutureFailures.push({
      risk: "If the anchor product changes during the session, look board may be built around wrong anchor",
      likelihood: 0.3,
      mitigation: "Confirm anchor: 'Are you building the look around this piece, or a different one?'",
    });
  }
  if (scenario.archetype.type === "returning_shopper") {
    critique.hiddenFutureFailures.push({
      risk: "Mira may recommend a product the shopper already owns if that handle isn't in shownHandles",
      likelihood: 0.7,
      mitigation: "Pass purchased product handles in shownHandles when returning shopper identity is known",
    });
  }
  if (route === "try_on" && scenario.archetype.state === "browsing") {
    critique.hiddenFutureFailures.push({
      risk: "Try-on offer on a browsing shopper may feel intrusive — wrong timing",
      likelihood: 0.45,
      mitigation: "Try-on should require at minimum DECIDING state (dwell + product interest). Gate behavioral triggers on state confidence ≥ 0.5",
    });
  }
  if (scenario.archetype.type === "emotional_shopper") {
    critique.hiddenFutureFailures.push({
      risk: "Mira may recommend based on category/price rather than the emotional goal — 'interview' needs power, not just formal",
      likelihood: 0.55,
      mitigation: "Add emotional intent classifier: map 'interview' → power/authority, 'first date' → attraction/confidence. Drive recommendation from the emotional goal.",
    });
  }

  return critique;
}

// ── Failure pattern analyzer ───────────────────────────────────────────────────
function analyzeFailurePatterns(results) {
  const failureCounts = {};
  const failuresByArchetype = {};

  for (const r of results) {
    for (const f of r.evaluation.failures) {
      failureCounts[f.type] = (failureCounts[f.type] ?? 0) + 1;
      failuresByArchetype[r.scenario.shopperType] = failuresByArchetype[r.scenario.shopperType] ?? {};
      failuresByArchetype[r.scenario.shopperType][f.type] = (failuresByArchetype[r.scenario.shopperType][f.type] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(failureCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      count,
      percentage: Math.round((count / results.length) * 100),
      affectedArchetypes: Object.entries(failuresByArchetype)
        .filter(([, types]) => types[type])
        .map(([archetype]) => archetype),
    }));

  return sorted;
}

// ── Improvement proposer ───────────────────────────────────────────────────────
function proposeImprovements(failurePatterns, results) {
  const proposals = [];

  for (const pattern of failurePatterns.slice(0, 8)) {
    const representativeFailure = results
      .flatMap(r => r.evaluation.failures)
      .find(f => f.type === pattern.type);

    if (!representativeFailure) continue;

    const proposal = {
      priority: pattern.count >= 4 ? "P0" : pattern.count >= 2 ? "P1" : "P2",
      failureType: pattern.type,
      occurrences: pattern.count,
      percentage: pattern.percentage,
      rootCause: representativeFailure.rootCause ?? "unknown",
      proposedFix: representativeFailure.fix ?? "Investigate and add explicit rule",
      affectedFile: getAffectedFile(pattern.type),
      affectedSection: getAffectedSection(pattern.type),
      implementationNote: getImplementationNote(pattern.type),
    };

    proposals.push(proposal);
  }

  return proposals;
}

function getAffectedFile(failureType) {
  const map = {
    [FAILURE_TYPES.HALLUCINATION]:      "apps/web/app/api/mira/route.ts → attemptModel()",
    [FAILURE_TYPES.PDP_BLIND]:          "apps/web/app/api/mira/route.ts → buildPrompt() + buildSystem()",
    [FAILURE_TYPES.ANSWER_DEFLECTION]:  "apps/web/app/api/mira/route.ts → buildSystem() HOW TO TALK",
    [FAILURE_TYPES.COLOR_IMPRECISION]:  "apps/web/app/api/mira/route.ts → COLOR_ADJACENCY + buildSystem()",
    [FAILURE_TYPES.COMPARISON_DODGE]:   "apps/web/app/api/mira/route.ts → buildSystem() COMPARISON rule",
    [FAILURE_TYPES.WRONG_ROUTE]:        "apps/web/app/api/mira/route.ts → buildSystem() ROUTE SELECTION",
    [FAILURE_TYPES.MISSING_UNMET]:      "apps/web/app/api/mira/route.ts → buildSystem() CATALOG GAPS",
    [FAILURE_TYPES.MISSING_NEAR_MISS]:  "apps/web/app/api/mira/route.ts → buildSystem() NEAR-MISS",
    [FAILURE_TYPES.GENERIC_VOICE]:      "apps/web/app/api/mira/route.ts → buildSystem() HOW TO TALK",
    [FAILURE_TYPES.BODY_MEMORY_MISS]:   "apps/web/app/api/mira/route.ts → extractBodyContext()",
    [FAILURE_TYPES.OUTFIT_WRONG_ROUTE]: "apps/web/app/api/mira/route.ts → buildSystem() ROUTE SELECTION",
    [FAILURE_TYPES.PREMATURE_CLOSE]:    "apps/web/app/api/mira/route.ts → buildSystem() HOW A GREAT SALESPERSON SELLS",
    [FAILURE_TYPES.LATE_CLOSE]:         "apps/web/app/api/mira/route.ts → buildSystem() HOW A GREAT SALESPERSON SELLS step 9",
  };
  return map[failureType] ?? "apps/web/app/api/mira/route.ts";
}

function getAffectedSection(failureType) {
  const map = {
    [FAILURE_TYPES.HALLUCINATION]:      "validateHandle() post-processing",
    [FAILURE_TYPES.PDP_BLIND]:          "PDP COLD OPEN instruction block",
    [FAILURE_TYPES.ANSWER_DEFLECTION]:  "ANSWER FIRST rule",
    [FAILURE_TYPES.COLOR_IMPRECISION]:  "COLOR PRECISION rule + COLOR_ADJACENCY map",
    [FAILURE_TYPES.COMPARISON_DODGE]:   "COMPARISON rule",
    [FAILURE_TYPES.WRONG_ROUTE]:        "ROUTE SELECTION examples",
    [FAILURE_TYPES.MISSING_UNMET]:      "CATALOG GAPS block",
    [FAILURE_TYPES.MISSING_NEAR_MISS]:  "NEAR-MISS block",
    [FAILURE_TYPES.GENERIC_VOICE]:      "HOW TO TALK + BANNED words list",
    [FAILURE_TYPES.BODY_MEMORY_MISS]:   "extractBodyContext() regex",
    [FAILURE_TYPES.OUTFIT_WRONG_ROUTE]: "ROUTE SELECTION — look vs reco_handle disambiguation",
  };
  return map[failureType] ?? "system prompt";
}

function getImplementationNote(failureType) {
  const map = {
    [FAILURE_TYPES.HALLUCINATION]:      "Add unit test: run 20 turns and assert every productHandle passes VALID_HANDLES.has()",
    [FAILURE_TYPES.PDP_BLIND]:          "Increase specificity of ⚠ PDP COLD OPEN instruction. Add 3 more forbidden examples.",
    [FAILURE_TYPES.ANSWER_DEFLECTION]:  "Add 2 more few-shots showing direct question → answer first pattern",
    [FAILURE_TYPES.COLOR_IMPRECISION]:  "Extend COLOR_ADJACENCY map. Add explicit instruction: 'the color word must appear verbatim in our catalog list'",
    [FAILURE_TYPES.COMPARISON_DODGE]:   "Add few-shot: comparison → [opinion] + [reason] + [qualifying question]. Mark deflection-only as failure.",
    [FAILURE_TYPES.WRONG_ROUTE]:        "Add more disambiguation examples to ROUTE SELECTION block",
    [FAILURE_TYPES.MISSING_UNMET]:      "Add more gap trigger phrases to CATALOG GAPS block",
    [FAILURE_TYPES.MISSING_NEAR_MISS]:  "Add more near-miss patterns. Test: 'this but in [color]', 'do you have this [variant]'",
    [FAILURE_TYPES.GENERIC_VOICE]:      "Add to BANNED list, add counter-example showing natural alternative",
    [FAILURE_TYPES.BODY_MEMORY_MISS]:   "Extend regex to cover more height/weight formats. Test: '5'7', '170cm', '65 kilos'",
    [FAILURE_TYPES.OUTFIT_WRONG_ROUTE]: "Add explicit few-shot: 'complete the outfit / build the look / full look' → route: 'look', NOT 'reco_handle'",
  };
  return map[failureType] ?? "Investigate root cause and add a specific rule or example";
}

// ── Memory manager ─────────────────────────────────────────────────────────────
function updateMemory(results, proposals, cycleScore) {
  let memory = {};
  try {
    memory = JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
  } catch {
    memory = { cycleCount: 0, evolutionScores: [], successPatterns: [], failurePatterns: [], proposedImprovements: [], stylistPhrases: { strong: [], weak: [] } };
  }

  memory.version = (memory.version ?? 0) + 1;
  memory.lastUpdated = new Date().toISOString();
  memory.cycleCount = (memory.cycleCount ?? 0) + 1;
  memory.evolutionScores.push({ cycle: memory.cycleCount, score: cycleScore, timestamp: memory.lastUpdated });

  // Keep only last 10 cycles of scores
  if (memory.evolutionScores.length > 10) memory.evolutionScores = memory.evolutionScores.slice(-10);

  // Accumulate failure patterns (deduplicated by type)
  for (const p of proposals) {
    const existing = memory.proposedImprovements.find(e => e.failureType === p.failureType);
    if (existing) {
      existing.occurrences += p.occurrences;
      existing.lastSeen = memory.lastUpdated;
    } else {
      memory.proposedImprovements.push({ ...p, firstSeen: memory.lastUpdated, lastSeen: memory.lastUpdated });
    }
  }

  // Store strong stylist phrases (from high-scoring turns)
  const strongTurns = results.filter(r => r.evaluation.scores.overall >= 8);
  for (const t of strongTurns.slice(0, 5)) {
    if (t.decision?.voice && !memory.stylistPhrases.strong.includes(t.decision.voice)) {
      memory.stylistPhrases.strong.push(t.decision.voice);
    }
  }
  if (memory.stylistPhrases.strong.length > 50) memory.stylistPhrases.strong = memory.stylistPhrases.strong.slice(-50);

  // Store weak phrases (from failing turns with generic voice failure)
  const weakTurns = results.filter(r => r.evaluation.failures.some(f => f.type === FAILURE_TYPES.GENERIC_VOICE));
  for (const t of weakTurns.slice(0, 5)) {
    if (t.decision?.voice && !memory.stylistPhrases.weak.includes(t.decision.voice)) {
      memory.stylistPhrases.weak.push(t.decision.voice);
    }
  }
  if (memory.stylistPhrases.weak.length > 30) memory.stylistPhrases.weak = memory.stylistPhrases.weak.slice(-30);

  writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
  return memory;
}

// ── Evolution tracker ──────────────────────────────────────────────────────────
function trackEvolution(cycleScore, cycleNumber) {
  let history = { cycles: [] };
  try {
    history = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch { /* first run */ }

  history.cycles.push({
    cycle: cycleNumber,
    score: cycleScore,
    timestamp: new Date().toISOString(),
  });

  if (history.cycles.length > 1) {
    const prev = history.cycles[history.cycles.length - 2].score;
    const curr = cycleScore;
    history.trend = curr > prev ? "improving" : curr < prev ? "regressing" : "stable";
    history.delta = Math.round((curr - prev) * 100) / 100;
  } else {
    history.trend = "baseline";
    history.delta = 0;
  }

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  return history;
}

// ── Report generator ───────────────────────────────────────────────────────────
function generateReport(allResults, proposals, failurePatterns, cycleScore, memory, evolutionHistory, cycleNumber) {
  const passCount = allResults.filter(r => r.evaluation.failures.length === 0).length;
  const partialCount = allResults.filter(r => r.evaluation.failures.length > 0 && r.evaluation.scores.overall >= 5).length;
  const failCount = allResults.filter(r => r.evaluation.scores.overall < 5).length;

  const avgScores = {
    stylist: Math.round(allResults.reduce((s, r) => s + r.evaluation.scores.stylist, 0) / allResults.length * 10) / 10,
    emotional: Math.round(allResults.reduce((s, r) => s + r.evaluation.scores.emotional, 0) / allResults.length * 10) / 10,
    sales: Math.round(allResults.reduce((s, r) => s + r.evaluation.scores.sales, 0) / allResults.length * 10) / 10,
    intelligence: Math.round(allResults.reduce((s, r) => s + r.evaluation.scores.intelligence, 0) / allResults.length * 10) / 10,
    overall: cycleScore,
  };

  const allHiddenFailures = allResults.flatMap(r => r.critique.hiddenFutureFailures ?? []);
  const uniqueHiddenFailures = allHiddenFailures.filter((f, i, a) => a.findIndex(x => x.risk === f.risk) === i);
  const highRiskHiddenFailures = uniqueHiddenFailures.filter(f => f.likelihood >= 0.5);

  const report = {
    cycle: cycleNumber,
    timestamp: new Date().toISOString(),
    summary: {
      totalScenarios: allResults.length,
      passed: passCount,
      partial: partialCount,
      failed: failCount,
      passRate: Math.round((passCount / allResults.length) * 100),
      evolutionScore: cycleScore,
      trend: evolutionHistory.trend,
      delta: evolutionHistory.delta,
    },
    scores: avgScores,
    failurePatterns: failurePatterns.slice(0, 10),
    proposals: proposals,
    hiddenFutureFailures: highRiskHiddenFailures,
    allHiddenFailures: uniqueHiddenFailures,
    detailedResults: allResults.map(r => ({
      id: r.scenario.id,
      shopperType: r.scenario.shopperType,
      shopperState: r.scenario.shopperState,
      pageType: r.scenario.pageType,
      productHandle: r.scenario.currentProductHandle,
      message: r.scenario.message,
      voice: r.decision?.voice?.slice(0, 120),
      route: r.decision?.route,
      handle: r.decision?.productHandle,
      intent: r.decision?.intent,
      unmet: r.decision?.unmet,
      nearMiss: r.decision?.nearMiss,
      scores: r.evaluation.scores,
      failures: r.evaluation.failures.map(f => ({ type: f.type, detail: f.detail.slice(0, 100) })),
      warnings: r.evaluation.warnings,
      successes: r.evaluation.successes,
      critique: r.critique,
    })),
    memory: {
      cycleCount: memory.cycleCount,
      evolutionScores: memory.evolutionScores,
      strongPhraseCount: memory.stylistPhrases?.strong?.length ?? 0,
      weakPhraseCount: memory.stylistPhrases?.weak?.length ?? 0,
      totalProposalsAccumulated: memory.proposedImprovements?.length ?? 0,
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

// ── Console reporter ───────────────────────────────────────────────────────────
function printReport(report) {
  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
    blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
    white: "\x1b[37m", bgBlue: "\x1b[44m",
  };

  const trendIcon = { improving: "↑", regressing: "↓", stable: "→", baseline: "◆" };
  const scoreBar = (s) => "█".repeat(Math.round(s)) + "░".repeat(10 - Math.round(s));

  console.log(`\n${C.bold}${C.bgBlue}  Mira Self-Training Loop — Cycle ${report.cycle}  ${C.reset}\n`);
  console.log(`${C.dim}${new Date(report.timestamp).toLocaleString()}${C.reset}\n`);

  // Summary
  console.log(`${C.bold}SIMULATION RESULTS${C.reset}`);
  console.log(`  Scenarios: ${report.summary.totalScenarios}`);
  console.log(`  ${C.green}Pass: ${report.summary.passed}${C.reset}  ${C.yellow}Partial: ${report.summary.partial}${C.reset}  ${C.red}Fail: ${report.summary.failed}${C.reset}`);
  console.log(`  Pass rate: ${report.summary.passRate}%`);

  // Evolution
  const trendColor = report.summary.trend === "improving" ? C.green : report.summary.trend === "regressing" ? C.red : C.yellow;
  console.log(`\n${C.bold}EVOLUTION SCORE${C.reset}`);
  console.log(`  ${C.bold}${report.scores.overall}/10${C.reset}  ${trendColor}${trendIcon[report.summary.trend]} ${report.summary.delta > 0 ? "+" : ""}${report.summary.delta}${C.reset}`);

  // Score dimensions
  console.log(`\n${C.bold}DIMENSION SCORES${C.reset}`);
  const dims = [
    ["Stylist Quality",   report.scores.stylist],
    ["Emotional Intell.", report.scores.emotional],
    ["Sales Ability",     report.scores.sales],
    ["Intelligence Loop", report.scores.intelligence],
  ];
  for (const [label, score] of dims) {
    const color = score >= 7 ? C.green : score >= 5 ? C.yellow : C.red;
    console.log(`  ${label.padEnd(18)} ${color}${scoreBar(score)}${C.reset} ${score.toFixed(1)}`);
  }

  // Top failures
  if (report.failurePatterns.length > 0) {
    console.log(`\n${C.bold}TOP FAILURE PATTERNS${C.reset}`);
    for (const f of report.failurePatterns.slice(0, 6)) {
      const icon = f.count >= 4 ? `${C.red}●${C.reset}` : f.count >= 2 ? `${C.yellow}●${C.reset}` : `${C.dim}●${C.reset}`;
      console.log(`  ${icon} ${f.type.padEnd(28)} ${f.count}x (${f.percentage}%)`);
    }
  }

  // P0 proposals
  const p0 = report.proposals.filter(p => p.priority === "P0");
  if (p0.length > 0) {
    console.log(`\n${C.bold}${C.red}P0 FIXES REQUIRED${C.reset}`);
    for (const p of p0) {
      console.log(`  ${C.red}▶${C.reset} ${p.failureType}`);
      console.log(`    ${C.dim}${p.proposedFix.slice(0, 100)}${C.reset}`);
      console.log(`    ${C.cyan}File: ${p.affectedFile.split("→")[0].trim()}${C.reset}`);
    }
  }

  // P1 proposals
  const p1 = report.proposals.filter(p => p.priority === "P1");
  if (p1.length > 0) {
    console.log(`\n${C.bold}${C.yellow}P1 IMPROVEMENTS${C.reset}`);
    for (const p of p1) {
      console.log(`  ${C.yellow}▶${C.reset} ${p.failureType}: ${p.proposedFix.slice(0, 90)}`);
    }
  }

  // Hidden future failures
  if (report.hiddenFutureFailures.length > 0) {
    console.log(`\n${C.bold}${C.magenta}PREDICTED FUTURE FAILURES (likelihood ≥ 50%)${C.reset}`);
    for (const hf of report.hiddenFutureFailures.slice(0, 5)) {
      console.log(`  ${C.magenta}◈${C.reset} ${hf.risk.slice(0, 90)}`);
      console.log(`    ${C.dim}Mitigation: ${hf.mitigation.slice(0, 90)}${C.reset}`);
    }
  }

  // Memory
  console.log(`\n${C.bold}BEHAVIORAL MEMORY${C.reset}`);
  console.log(`  Cycles run:    ${report.memory.cycleCount}`);
  console.log(`  Strong phrases stored: ${report.memory.strongPhraseCount}`);
  console.log(`  Proposals accumulated: ${report.memory.totalProposalsAccumulated}`);

  if (report.memory.evolutionScores.length > 1) {
    console.log(`  Evolution:     ${report.memory.evolutionScores.map(e => e.score.toFixed(1)).join(" → ")}`);
  }

  console.log(`\n${C.dim}Full report: apps/web/data/mira-training-report.json${C.reset}`);
  console.log(`${C.dim}Memory:      apps/web/data/mira-behavioral-memory.json${C.reset}\n`);
}

// ── Main training loop ─────────────────────────────────────────────────────────
async function runTrainingCycle(cycleNumber) {
  console.log(`\n\x1b[36m► Running training cycle ${cycleNumber} — ${SCENARIO_COUNT} scenarios...\x1b[0m`);

  // 1. Generate scenarios
  const scenarios = [];
  let archetypeIndex = 0;
  for (let i = 0; i < SCENARIO_COUNT; i++) {
    const archetype = SHOPPER_ARCHETYPES[archetypeIndex % SHOPPER_ARCHETYPES.length];
    scenarios.push(generateScenario(archetype, Math.floor(i / SHOPPER_ARCHETYPES.length)));
    archetypeIndex++;
  }

  // 2. Run simulations (conservative batches of 4 with 1.5s gap to avoid Gemini 503s)
  const allResults = [];
  const BATCH = 4;
  for (let i = 0; i < scenarios.length; i += BATCH) {
    const batch = scenarios.slice(i, i + BATCH);
    process.stdout.write(`  Simulating ${Math.min(i + BATCH, scenarios.length)}/${scenarios.length}...\r`);
    if (i > 0) await new Promise(r => setTimeout(r, 1500)); // rate-limit — Gemini 2.5 Pro has ~30 RPM
    const decisions = await Promise.all(batch.map(s => callMira(s)));
    for (let j = 0; j < batch.length; j++) {
      const scenario = batch[j];
      const decision = decisions[j];
      const evaluation = evaluateResponse(scenario, decision);
      const critique = selfCritique(scenario, decision, evaluation);
      allResults.push({ scenario, decision, evaluation, critique });
    }
  }
  console.log();

  // 3. Analyze patterns
  const failurePatterns = analyzeFailurePatterns(allResults);

  // 4. Propose improvements
  const proposals = proposeImprovements(failurePatterns, allResults);

  // 5. Compute cycle score
  const avgOverall = allResults.reduce((s, r) => s + r.evaluation.scores.overall, 0) / allResults.length;
  const cycleScore = Math.round(avgOverall * 10) / 10;

  // 6. Update memory
  const memory = updateMemory(allResults, proposals, cycleScore);

  // 7. Track evolution
  const evolutionHistory = trackEvolution(cycleScore, cycleNumber);

  // 8. Generate report
  const report = generateReport(allResults, proposals, failurePatterns, cycleScore, memory, evolutionHistory, cycleNumber);

  // 9. Print to console
  printReport(report);

  return { cycleScore, proposals, failurePatterns };
}

// ── Entry point ────────────────────────────────────────────────────────────────
(async () => {
  console.log("\x1b[1m\x1b[35mMira Self-Training Intelligence Loop\x1b[0m");
  console.log("\x1b[2mBehavioral simulation → evaluation → failure detection → refinement\x1b[0m\n");

  // Verify server is running
  try {
    const probe = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", history: [] }),
    });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (e) {
    console.error(`\x1b[31m✗ Mira API not reachable at ${API}\x1b[0m`);
    console.error(`  Start the server first: cd apps/web && pnpm dev --port 3000`);
    process.exit(1);
  }

  let lastScore = null;
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const { cycleScore, proposals } = await runTrainingCycle(cycle);

    if (lastScore !== null) {
      const delta = cycleScore - lastScore;
      const direction = delta > 0 ? "\x1b[32m↑ improving\x1b[0m" : delta < 0 ? "\x1b[31m↓ regressing\x1b[0m" : "\x1b[33m→ stable\x1b[0m";
      console.log(`  Cycle ${cycle - 1} → ${cycle}: ${lastScore} → ${cycleScore} (${direction})`);
    }
    lastScore = cycleScore;

    // Between cycles: propose what to fix
    if (cycle < CYCLES && proposals.length > 0) {
      console.log(`\n\x1b[33m  Top fix before next cycle:\x1b[0m`);
      console.log(`  ${proposals[0].failureType}: ${proposals[0].proposedFix.slice(0, 100)}`);
      console.log(`  Apply this fix, then the next cycle will re-test it.\n`);
    }
  }

  console.log("\x1b[1m\x1b[32m✓ Training loop complete.\x1b[0m");
  console.log(`\x1b[2mRun again after applying fixes to measure improvement.\x1b[0m`);
  console.log(`\x1b[2mUse --cycles 3 to run multiple cycles in sequence.\x1b[0m\n`);
})();
