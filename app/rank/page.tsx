import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { RankApp } from "@/components/RankApp";

export default async function RankPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <RankApp username={session.username} />;
}
