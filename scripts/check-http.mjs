#!/usr/bin/env node

const target = process.argv[2];
const okField = process.argv[3] ?? "ok";

if (!target) {
  console.error("usage: node scripts/check-http.mjs <url> [okField]");
  process.exit(2);
}

try {
  const res = await fetch(target, { signal: AbortSignal.timeout(5_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  const ok = res.ok && body?.[okField] === true;
  if (!ok) {
    console.error(JSON.stringify({ ok: false, status: res.status, target, body }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, status: res.status, target, body }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    target,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
}
