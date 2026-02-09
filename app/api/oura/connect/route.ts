import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getOuraAuthorizeUrl, isOuraConfigured } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

const OURA_STATE_COOKIE = "oura_oauth_state";
const OURA_NEXT_COOKIE = "oura_oauth_next";

export async function GET(req: NextRequest) {
  const { response } = await requireSession();
  if (response) return response;

  if (!isOuraConfigured()) {
    return NextResponse.json({ error: "Oura is not configured on this deployment." }, { status: 500 });
  }

  try {
    const state = crypto.randomUUID();
    const nextPath = req.nextUrl.searchParams.get("next");
    const safeNextPath = nextPath && nextPath.startsWith("/") ? nextPath : "/settings";

    cookies().set(OURA_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });
    cookies().set(OURA_NEXT_COOKIE, safeNextPath, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    const authorizeUrl = getOuraAuthorizeUrl(state);
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error("GET /api/oura/connect failed", error);
    return NextResponse.json({ error: "Could not start Oura OAuth." }, { status: 500 });
  }
}
