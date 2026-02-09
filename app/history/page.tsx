import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { HistoryApp } from "@/components/HistoryApp";

export default async function HistoryPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <HistoryApp username={session.username} />;
}
