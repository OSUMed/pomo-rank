import { NextRequest, NextResponse } from "next/server";
import { createUser, findUserByUsername, hashPassword } from "@/lib/auth";
import { createSession, setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");

    if (cleanUsername.length < 3 || cleanPassword.length < 6) {
      return NextResponse.json({ error: "Username must be >= 3 chars and password >= 6 chars." }, { status: 400 });
    }

    const existing = await findUserByUsername(cleanUsername);
    if (existing) {
      return NextResponse.json({ error: "Username already exists." }, { status: 409 });
    }

    const passwordHash = await hashPassword(cleanPassword);
    const user = await createUser(cleanUsername, passwordHash);

    const token = await createSession({ userId: user.id, username: user.username });
    await setSessionCookie(token);

    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch {
    return NextResponse.json({ error: "Failed to register." }, { status: 500 });
  }
}
