import { NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { revokeOuraConnection } from "@/lib/oura";

export async function POST() {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    await revokeOuraConnection(session.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/oura/disconnect failed", error);
    return NextResponse.json({ error: "Failed to disconnect Oura." }, { status: 500 });
  }
}
