import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/data";
import { requireSession } from "@/lib/route-auth";

export async function GET(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "true";
    const projects = await listProjects(session.userId, includeArchived);
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("GET /api/projects failed", error);
    return NextResponse.json({ error: "Failed to load projects." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const { name, color } = await req.json();
    const project = await createProject(session.userId, String(name || ""), color ? String(color) : null);
    return NextResponse.json({ project });
  } catch (error) {
    console.error("POST /api/projects failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create project." }, { status: 400 });
  }
}
