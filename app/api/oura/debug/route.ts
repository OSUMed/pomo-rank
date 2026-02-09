import { NextResponse } from "next/server";
import { getOuraScopeDebug, isOuraConfigured } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    if (!isOuraConfigured()) {
      return NextResponse.json({
        configured: false,
        connected: false,
        storedScope: null,
        grantedScopes: [],
        requiredScopes: ["heartrate", "daily"],
        missingScopes: ["heartrate", "daily"],
        expiresAt: null,
        tokenType: null,
      });
    }

    const scopeDebug = await getOuraScopeDebug(session.userId);
    return NextResponse.json({ configured: true, ...scopeDebug });
  } catch (error) {
    console.error("GET /api/oura/debug failed", error);
    return NextResponse.json({ error: "Failed to load Oura debug info." }, { status: 500 });
  }
}
