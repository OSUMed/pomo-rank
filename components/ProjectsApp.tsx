"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ProjectSummary = {
  id: string;
  name: string;
  archived: boolean;
  totalSeconds: number;
};

function formatHoursMinutesFromSeconds(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}min`;
}

export function ProjectsApp({ username }: { username: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    const res = await fetch("/api/projects/summary", { cache: "no-store" });
    if (!res.ok) return;
    const payload = await res.json();
    setProjects(payload.projects || []);
  }

  async function createProject() {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });

    if (!res.ok) {
      setMessage("Could not create project.");
      return;
    }

    setNewName("");
    setMessage("Project created.");
    await loadProjects();
  }

  async function setArchived(projectId: string, archived: boolean) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });

    if (!res.ok) {
      setMessage("Could not update project.");
      return;
    }

    setMessage(archived ? "Project archived." : "Project restored.");
    await loadProjects();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archived).sort((a, b) => b.totalSeconds - a.totalSeconds),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((p) => p.archived).sort((a, b) => b.totalSeconds - a.totalSeconds),
    [projects],
  );

  return (
    <main className="app-shell stats-shell">
      <section className="timer-card stats-card">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Project Hub</p>
              <h1>Projects</h1>
              <p className="subtitle">Signed in as {username}</p>
            </div>
            <div className="nav-group">
              <Link className="ghost nav-link" href="/dashboard">
                Back Timer
              </Link>
              <Link className="ghost nav-link" href="/stats">
                Stats
              </Link>
              <button className="ghost" onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="settings-panel project-create-panel">
          <h2>Create Project</h2>
          <div className="inline-row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Leetcode" />
            <button className="primary" onClick={createProject}>
              Add Project
            </button>
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </section>

        <section className="rank-panel">
          <h2>Active Projects</h2>
          <div className="project-rows">
            {activeProjects.map((project) => (
              <article key={project.id} className="project-row project-row--manage">
                <div className="project-row-meta">
                  <strong>{project.name}</strong>
                  <span>{formatHoursMinutesFromSeconds(project.totalSeconds)}</span>
                </div>
                <div className="project-actions">
                  <button className="ghost" onClick={() => setArchived(project.id, true)}>
                    Archive
                  </button>
                </div>
              </article>
            ))}
            {!activeProjects.length ? <p className="hint">No active projects yet.</p> : null}
          </div>
        </section>

        <section className="rank-panel">
          <h2>Archived Projects</h2>
          <div className="project-rows">
            {archivedProjects.map((project) => (
              <article key={project.id} className="project-row project-row--manage">
                <div className="project-row-meta">
                  <strong>{project.name}</strong>
                  <span>{formatHoursMinutesFromSeconds(project.totalSeconds)}</span>
                </div>
                <div className="project-actions">
                  <button className="ghost" onClick={() => setArchived(project.id, false)}>
                    Restore
                  </button>
                </div>
              </article>
            ))}
            {!archivedProjects.length ? <p className="hint">No archived projects.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
