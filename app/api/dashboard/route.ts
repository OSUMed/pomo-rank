import { NextRequest, NextResponse } from "next/server";
import { getTodaySummary } from "@/lib/data";
import { requireSession } from "@/lib/route-auth";

export async function GET(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "all";
    const summary = await getTodaySummary(session.userId, projectId);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("GET /api/dashboard failed", error);
    return NextResponse.json({ error: "Failed to load dashboard summary." }, { status: 500 });
  }
}
