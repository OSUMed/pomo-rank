import { NextRequest, NextResponse } from "next/server";
import { getStats } from "@/lib/data";
import { requireSession } from "@/lib/route-auth";
import { Period } from "@/types";

function parsePeriod(value: string | null): Period {
  if (value === "day" || value === "month" || value === "year") return value;
  return "week";
}

export async function GET(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "all";
    const period = parsePeriod(req.nextUrl.searchParams.get("period"));
    const anchorDate = req.nextUrl.searchParams.get("anchorDate") || undefined;

    const stats = await getStats(session.userId, projectId, period, anchorDate);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("GET /api/stats failed", error);
    return NextResponse.json({ error: "Failed to load stats." }, { status: 500 });
  }
}
