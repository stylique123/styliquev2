import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// CORS so the Shopify storefront widget (different origin) can call the demo's
// Mira chat + try-on render APIs. Cookie-less, so a wildcard origin is safe.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as Record<string, string>;

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }

  if (!request.nextUrl.pathname.startsWith("/admin")) return NextResponse.next();

  // Login page is always accessible
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();

  const session = request.cookies.get("sq_admin_session")?.value;
  const secret = process.env.STYLIQUE_ADMIN_SECRET;

  if (!secret) {
    return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }

  if (session !== secret) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/:path*"] };
