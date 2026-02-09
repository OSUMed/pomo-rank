import { NextResponse } from "next/server";
import { getOuraMetrics, isOuraConfigured } from "@/lib/oura";
import { requireSession } from "@/lib/route-auth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  const missing: string[] = [];
  if (!process.env.OURA_CLIENT_ID) missing.push("OURA_CLIENT_ID");
  if (!process.env.OURA_CLIENT_SECRET) missing.push("OURA_CLIENT_SECRET");
  if (!process.env.OURA_REDIRECT_URI) missing.push("OURA_REDIRECT_URI");

  if (!isOuraConfigured()) {
    console.error("GET /api/oura/metrics not configured", {
      userId: session.userId,
      missing,
    });
    return NextResponse.json({
      configured: false,
      missing,
      connected: false,
      heartRate: null,
      heartRateTime: null,
      stressState: null,
      stressDate: null,
      warning: null,
    });
  }

  try {
    const metrics = await getOuraMetrics(session.userId);
    return NextResponse.json({
      configured: true,
      missing: [],
      ...metrics,
    });
  } catch (error) {
    console.error("GET /api/oura/metrics failed", error);
    return NextResponse.json({
      configured: true,
      missing: [],
      connected: false,
      heartRate: null,
      heartRateTime: null,
      stressState: null,
      stressDate: null,
      warning: "Unexpected Oura error. Please reconnect Oura.",
      error: "Failed to load Oura metrics.",
    });
  }
}
