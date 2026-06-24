#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function stringSetFromNewSet(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}[^=]*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!match) throw new Error(`Could not find ${name}`);
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function unionTypeMembers(source, name) {
  const match = source.match(new RegExp(`type\\s+${name}\\s*=([\\s\\S]*?);`));
  if (!match) throw new Error(`Could not find ${name}`);
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function emittedPostClientEvents(source) {
  return new Set([...source.matchAll(/postClientEvent\("([^"]+)"/g)].map((m) => m[1]));
}

const widget = read("apps/web/app/components/mira/MiraWidget.tsx");
const shopperEvents = read("apps/shopify-app/app/lib/shopper-events.server.ts");
const bridge = read("apps/shopify-app/app/routes/api.mira.event.tsx");

const clientType = unionTypeMembers(widget, "ClientEventName");
const emitted = emittedPostClientEvents(widget);
const clientAllowlist = stringSetFromNewSet(shopperEvents, "CLIENT_POSTABLE_EVENTS");
const bridgeAllowlist = stringSetFromNewSet(bridge, "BRIDGE_ACCEPTED_EVENTS");

const missingFromType = [...emitted].filter((event) => !clientType.has(event));
const missingFromClientAllowlist = [...emitted].filter((event) => !clientAllowlist.has(event));
const behavioralEvents = [...emitted].filter((event) =>
  event === "MIRA_PROACTIVE_TRIGGERED" || event.startsWith("MIRA_BEHAVIORAL_TRIGGER_"),
);
const missingFromBridge = behavioralEvents.filter((event) => !bridgeAllowlist.has(event));

const failures = [
  ...missingFromType.map((event) => `Widget emits ${event} but ClientEventName omits it`),
  ...missingFromClientAllowlist.map((event) => `Widget emits ${event} but CLIENT_POSTABLE_EVENTS omits it`),
  ...missingFromBridge.map((event) => `Behavioral event ${event} is client-emitted but BRIDGE_ACCEPTED_EVENTS omits it`),
];

if (failures.length > 0) {
  console.error("Client event allowlist drift detected:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`client event allowlist verifier passed (${emitted.size} widget events checked)`);
