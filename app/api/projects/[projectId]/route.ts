import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { setProjectArchived, setProjectColor } from "@/lib/data";

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const msg = typeof record.message === "string" ? record.message : "";
    const details = typeof record.details === "string" ? record.details : "";
    const hint = typeof record.hint === "string" ? record.hint : "";
    const code = typeof record.code === "string" ? record.code : "";
    return [msg, details, hint, code ? `code:${code}` : ""].filter(Boolean).join(" | ") || "Failed to update project.";
  }
  return "Failed to update project.";
}

function isConnectTimeoutError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const msg = String(record.message || "");
  const details = String(record.details || "");
  return (
    msg.includes("fetch failed") ||
    details.includes("fetch failed") ||
    details.includes("UND_ERR_CONNECT_TIMEOUT") ||
    details.includes("Connect Timeout Error")
  );
}

export async function PATCH(req: NextRequest, { params }: { params: { projectId: string } }) {
  const { session, response } = await requireSession();
  if (response || !session) return response!;

  try {
    const { archived, color } = await req.json();
    if (typeof color === "string" && color) {
      const project = await setProjectColor(session.userId, params.projectId, color);
      return NextResponse.json({ project });
    }

    const project = await setProjectArchived(session.userId, params.projectId, Boolean(archived));
    return NextResponse.json({ project });
  } catch (error) {
    const message = errorMessage(error);
    console.error("PATCH /api/projects/[projectId] failed", {
      projectId: params.projectId,
      error,
      message,
    });
    return NextResponse.json({ error: message }, { status: isConnectTimeoutError(error) ? 503 : 400 });
  }
}
