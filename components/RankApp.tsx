"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RANK_TIERS } from "@/lib/rank";

type Project = { id: string; name: string };

type RankStats = {
  rank: { title: string; subtitle: string };
  averageMinutes: number;
};

export function RankApp({ username }: { username: string }) {
  const search = useSearchParams();
  const initialProject = search.get("projectId") || "all";

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProject);
  const [stats, setStats] = useState<RankStats | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setProjects(payload.projects || []);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const q = new URLSearchParams({ projectId, period: "week" });
      const res = await fetch(`/api/stats?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setStats({ rank: payload.rank, averageMinutes: payload.averageMinutes });
    })();
  }, [projectId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="app-shell stats-shell">
      <section className="timer-card stats-card">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Rank Center</p>
              <h1>Greek Rank Ladder</h1>
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

        <section className="filters-row">
          <label className="inline-field inline-grow">
            Project Scope
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="stats-metrics">
          <article className="metric-card rank-card">
            <p>Current Rank</p>
            <h2>{stats?.rank.title ?? "Mortal"}</h2>
            <span>{stats?.rank.subtitle ?? "The journey begins."}</span>
          </article>
          <article className="metric-card">
            <p>Current 7-day average</p>
            <h2>{stats?.averageMinutes ?? 0} min/day</h2>
          </article>
        </section>

        <section className="rank-panel">
          <h2>Rank Tiers</h2>
          <div className="rank-ladder rank-ladder--single">
            {[...RANK_TIERS].reverse().map((tier) => (
              <article key={tier.title} className={`rank-tier ${stats?.rank.title === tier.title ? "is-active" : ""}`}>
                <h3>{tier.title}</h3>
                <p>{tier.minMinutes}+ min/day avg</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
