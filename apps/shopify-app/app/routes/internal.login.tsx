// Internal ops dashboard login page.
// Simple password gate — no Shopify OAuth required.
//
// Rate limiting: max 5 login attempts per IP per 15 minutes.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { buildInternalAuthCookie } from "../lib/internal-auth.server";
import { checkRateLimit } from "../lib/ratelimit.server";

const LOGIN_RATE_LIMIT = 5;      // max attempts
const LOGIN_WINDOW_MIN = 15;     // minutes

/** Extract a best-effort client IP from the request. */
function getClientIp(request: Request): string {
  return (
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Real-IP") ??
    "unknown"
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  // If already logged in, redirect to internal dashboard
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const token = parseCookie(cookieHeader, "sq_internal_token");
  const secret = process.env.STYLIQUE_INTERNAL_SECRET;
  if (secret && token) {
    // Dynamically import to avoid circular dependency
    const { requireInternalAuth } = await import("../lib/internal-auth.server");
    try {
      requireInternalAuth(request);
      throw redirect("/internal");
    } catch (e) {
      if (e instanceof Response) throw e;
      // Not authed — fall through to login form
    }
  }
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);

  // Rate-limit login attempts: 5 per IP per 15-minute window.
  // We reuse checkRateLimit with a synthetic "ip" type keyed on the IP.
  // Each window key is: rl:login-ip:<ip>:<window>  where window = floor(minute / LOGIN_WINDOW_MIN)
  const window15 = Math.floor(Math.floor(Date.now() / 60000) / LOGIN_WINDOW_MIN);
  const rateLimitKey = `login:${ip}:${window15}`;
  const allowed = await checkRateLimit("shopper", rateLimitKey, LOGIN_RATE_LIMIT);
  if (!allowed) {
    return json(
      { error: "Too many login attempts. Please wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const password = formData.get("password") as string | null;
  const secret = process.env.STYLIQUE_INTERNAL_SECRET;

  if (!secret) {
    return json(
      { error: "Internal dashboard is not configured (missing STYLIQUE_INTERNAL_SECRET)." },
      { status: 500 },
    );
  }

  // Use timingSafeEqual to prevent timing attacks on password comparison.
  if (!password || !secretMatches(password, secret)) {
    return json({ error: "Incorrect password." }, { status: 401 });
  }

  return redirect("/internal", {
    headers: { "Set-Cookie": buildInternalAuthCookie(secret) },
  });
}

function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k.trim() === name) return rest.join("=").trim();
  }
  return null;
}

function secretMatches(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export default function InternalLogin() {
  const data = useActionData<typeof action>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stylique Ops — Login</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #111;
            color: #e8e8e8;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .card {
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 40px;
            width: 100%;
            max-width: 360px;
          }
          .logo {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: #888;
            margin-bottom: 28px;
          }
          h1 {
            font-size: 20px;
            font-weight: 600;
            color: #f0f0f0;
            margin-bottom: 8px;
          }
          p {
            font-size: 13px;
            color: #888;
            margin-bottom: 24px;
          }
          label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #aaa;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
          }
          input[type="password"] {
            width: 100%;
            padding: 10px 12px;
            background: #0d0d0d;
            border: 1px solid #333;
            border-radius: 5px;
            color: #f0f0f0;
            font-size: 14px;
            font-family: monospace;
            outline: none;
          }
          input[type="password"]:focus { border-color: #666; }
          .error {
            margin-top: 10px;
            padding: 8px 12px;
            background: rgba(220,50,50,0.15);
            border: 1px solid rgba(220,50,50,0.3);
            border-radius: 4px;
            font-size: 13px;
            color: #f87171;
          }
          button {
            width: 100%;
            margin-top: 20px;
            padding: 11px;
            background: #fff;
            color: #000;
            border: none;
            border-radius: 5px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          }
          button:hover { background: #e0e0e0; }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="logo">Stylique Ops</div>
          <h1>Internal Dashboard</h1>
          <p>Team access only. Enter the ops password to continue.</p>
          <Form method="post">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              autoFocus
              autoComplete="current-password"
            />
            {data && "error" in data && (
              <div className="error">{data.error}</div>
            )}
            <button type="submit">Sign in</button>
          </Form>
        </div>
      </body>
    </html>
  );
}
