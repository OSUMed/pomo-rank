import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";

export async function requireSession() {
  const session = await readSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, response: null };
}
