import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername, verifyPassword } from "@/lib/auth";
import { createSession, setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");

    const user = await findUserByUsername(cleanUsername);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const valid = await verifyPassword(cleanPassword, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = await createSession({ userId: user.id, username: user.username });
    await setSessionCookie(token);

    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch {
    return NextResponse.json({ error: "Failed to login." }, { status: 500 });
  }
}
