import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { saveFocusTelemetry } from "@/lib/oura";

export async function POST(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const body = (await req.json()) as {
      sessionStartedAt?: string;
      sessionEndedAt?: string;
      baselineBpm?: number;
      peakRollingBpm?: number;
      avgRollingBpm?: number;
      alertWindows?: number;
    };

    if (!body.sessionStartedAt || !body.sessionEndedAt) {
      return NextResponse.json({ error: "Missing session timestamps" }, { status: 400 });
    }

    const profile = await saveFocusTelemetry(session.userId, {
      sessionStartedAt: body.sessionStartedAt,
      sessionEndedAt: body.sessionEndedAt,
      baselineBpm: Number(body.baselineBpm),
      peakRollingBpm: Number(body.peakRollingBpm),
      avgRollingBpm: Number(body.avgRollingBpm),
      alertWindows: Number(body.alertWindows) || 0,
    });

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    console.error("POST /api/oura/focus-telemetry failed", error);
    return NextResponse.json({ error: "Failed to save focus telemetry." }, { status: 500 });
  }
}
