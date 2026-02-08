import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { StatsApp } from "@/components/StatsApp";

export default async function StatsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <StatsApp username={session.username} />;
}
