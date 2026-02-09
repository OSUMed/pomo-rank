import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

const OURA_STATE_COOKIE = "oura_oauth_state";
const OURA_NEXT_COOKIE = "oura_oauth_next";

export async function GET(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = cookies().get(OURA_STATE_COOKIE)?.value;

  const nextPath = cookies().get(OURA_NEXT_COOKIE)?.value;
  const safeNextPath = nextPath && nextPath.startsWith("/") ? nextPath : "/settings";
  const redirectUrl = new URL(safeNextPath, req.url);

  if (!code || !state || !cookieState || state !== cookieState) {
    redirectUrl.searchParams.set("oura", "invalid_state");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    await exchangeCodeForToken(session.userId, code);

    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(OURA_STATE_COOKIE);
    res.cookies.delete(OURA_NEXT_COOKIE);
    res.cookies.set("oura_connected", "1", {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 30,
    });
    return res;
  } catch (error) {
    console.error("GET /api/oura/callback failed", error);
    redirectUrl.searchParams.set("oura", "connect_failed");

    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(OURA_STATE_COOKIE);
    res.cookies.delete(OURA_NEXT_COOKIE);
    return res;
  }
}
