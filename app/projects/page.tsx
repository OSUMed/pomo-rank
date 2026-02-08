import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { ProjectsApp } from "@/components/ProjectsApp";

export default async function ProjectsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  return <ProjectsApp username={session.username} />;
}
