import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { secret } = (await req.json()) as { secret: string };
  const adminSecret = process.env.STYLIQUE_ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("sq_admin_session", adminSecret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return response;
}
