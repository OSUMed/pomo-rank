import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { DashboardApp } from "@/components/DashboardApp";

export default async function DashboardPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <DashboardApp username={session.username} />;
}
