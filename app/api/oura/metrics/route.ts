import { NextResponse } from "next/server";
import { getOuraMetrics, isOuraConfigured } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  if (!isOuraConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      heartRate: null,
      heartRateTime: null,
      stressState: null,
      stressDate: null,
    });
  }

  try {
    const metrics = await getOuraMetrics(session.userId);
    return NextResponse.json({
      configured: true,
      ...metrics,
    });
  } catch (error) {
    console.error("GET /api/oura/metrics failed", error);
    return NextResponse.json({ error: "Failed to load Oura metrics." }, { status: 500 });
  }
}
