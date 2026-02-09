"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ProjectSummary = {
  id: string;
  name: string;
  archived: boolean;
  color: string | null;
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
  const [newColor, setNewColor] = useState("#2b5d8b");
  const [newColorText, setNewColorText] = useState("#2b5d8b");
  const [projectColorDrafts, setProjectColorDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  function normalizeHexColor(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    return null;
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    const res = await fetch("/api/projects/summary", { cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) {
      setMessage(payload?.error || "Could not load projects.");
      return;
    }
    const loaded = (payload.projects || []) as ProjectSummary[];
    setProjects(loaded);
    setProjectColorDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const project of loaded) {
        next[project.id] = prev[project.id] || project.color || "#2b5d8b";
      }
      return next;
    });
  }

  async function createProject() {
    const normalized = normalizeHexColor(newColorText);
    if (!normalized) {
      setMessage("Use a valid hex color like #2b5d8b.");
      return;
    }

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, color: normalized }),
    });

    const payload = await res.json();
    if (!res.ok) {
      setMessage(payload?.error || "Could not create project.");
      return;
    }

    setNewName("");
    setNewColor(normalized);
    setNewColorText(normalized);
    setMessage("Project created.");
    await loadProjects();
  }

  async function setProjectColor(projectId: string, color: string) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });

    const payload = await res.json();
    if (!res.ok) {
      setMessage(payload?.error || "Could not update project color.");
      return;
    }

    setMessage("Project color updated.");
    await loadProjects();
  }

  async function setArchived(projectId: string, archived: boolean) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });

    const payload = await res.json();
    if (!res.ok) {
      setMessage(payload?.error || "Could not update project.");
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
      <section className="timer-card stats-card projects-page-card">
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
            <label className="color-field">
              Color
              <input
                type="color"
                value={newColor}
                onChange={(e) => {
                  setNewColor(e.target.value);
                  setNewColorText(e.target.value);
                }}
              />
            </label>
            <label className="project-color-control project-color-control--create">
              Hex
              <input
                className="project-hex-input"
                value={newColorText}
                onChange={(e) => {
                  setNewColorText(e.target.value);
                  const normalized = normalizeHexColor(e.target.value);
                  if (normalized) setNewColor(normalized);
                }}
                placeholder="#2b5d8b"
              />
            </label>
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
                  <strong className="project-title-with-color">
                    <span className="project-color-dot" style={{ background: project.color || "#2b5d8b" }} />
                    {project.name}
                  </strong>
                  <span>{formatHoursMinutesFromSeconds(project.totalSeconds)}</span>
                </div>
                <label className="project-color-control">
                  Theme color
                  <div className="project-color-row">
                    <input
                      type="color"
                      value={projectColorDrafts[project.id] || project.color || "#2b5d8b"}
                      onChange={(e) =>
                        setProjectColorDrafts((prev) => ({
                          ...prev,
                          [project.id]: e.target.value,
                        }))
                      }
                    />
                    <input
                      className="project-hex-input"
                      value={projectColorDrafts[project.id] || project.color || "#2b5d8b"}
                      onChange={(e) =>
                        setProjectColorDrafts((prev) => ({
                          ...prev,
                          [project.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const normalized = normalizeHexColor(projectColorDrafts[project.id] || "");
                        if (!normalized) {
                          setMessage(`Use a valid hex color for ${project.name}.`);
                          return;
                        }
                        void setProjectColor(project.id, normalized);
                      }}
                      placeholder="#2b5d8b"
                    />
                    <button
                      className="ghost project-color-save"
                      onClick={() => {
                        const normalized = normalizeHexColor(projectColorDrafts[project.id] || "");
                        if (!normalized) {
                          setMessage(`Use a valid hex color for ${project.name}.`);
                          return;
                        }
                        void setProjectColor(project.id, normalized);
                      }}
                    >
                      Save Color
                    </button>
                  </div>
                </label>
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
                  <strong className="project-title-with-color">
                    <span className="project-color-dot" style={{ background: project.color || "#2b5d8b" }} />
                    {project.name}
                  </strong>
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
