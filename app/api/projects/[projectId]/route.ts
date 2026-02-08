import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { setProjectArchived } from "@/lib/data";

export async function PATCH(req: NextRequest, { params }: { params: { projectId: string } }) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const { archived } = await req.json();
    const project = await setProjectArchived(session.userId, params.projectId, Boolean(archived));
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Failed to update project." }, { status: 400 });
  }
}
