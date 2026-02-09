import { NextRequest, NextResponse } from "next/server";
import { getOuraBiofeedback, isOuraConfigured } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

export async function GET(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  const missing: string[] = [];
  if (!process.env.OURA_CLIENT_ID) missing.push("OURA_CLIENT_ID");
  if (!process.env.OURA_CLIENT_SECRET) missing.push("OURA_CLIENT_SECRET");
  if (!process.env.OURA_REDIRECT_URI) missing.push("OURA_REDIRECT_URI");

  if (!isOuraConfigured()) {
    return NextResponse.json({
      configured: false,
      missing,
      connected: false,
      heartRateSamples: [],
      latestHeartRate: null,
      latestHeartRateTime: null,
      stressToday: null,
      profile: {
        baselineMedianBpm: null,
        typicalDriftBpm: null,
        sampleCount: 0,
      },
      warning: null,
    });
  }

  try {
    const focusStart = req.nextUrl.searchParams.get("focusStart");
    const metrics = await getOuraBiofeedback(session.userId, focusStart);
    return NextResponse.json({
      configured: true,
      missing: [],
      ...metrics,
    });
  } catch (error) {
    console.error("GET /api/oura/metrics failed", error);
    return NextResponse.json(
      {
        configured: true,
        missing: [],
        connected: false,
        heartRateSamples: [],
        latestHeartRate: null,
        latestHeartRateTime: null,
        stressToday: null,
        profile: {
          baselineMedianBpm: null,
          typicalDriftBpm: null,
          sampleCount: 0,
        },
        warning: "Unexpected Oura error. Please reconnect Oura.",
        error: "Failed to load Oura metrics.",
      },
      { status: 500 },
    );
  }
}
