import { NextResponse } from "next/server";
import { getProjectTotals } from "@/lib/data";
import { requireSession } from "@/lib/route-auth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const projects = await getProjectTotals(session.userId);
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("GET /api/projects/summary failed", error);
    return NextResponse.json({ error: "Failed to load project totals." }, { status: 500 });
  }
}
