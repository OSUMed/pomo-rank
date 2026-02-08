import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { SettingsApp } from "@/components/SettingsApp";

export default async function SettingsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <SettingsApp username={session.username} />;
}
