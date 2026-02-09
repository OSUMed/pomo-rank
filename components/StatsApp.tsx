"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Period } from "@/types";
import { RANK_TIERS } from "@/lib/rank";

type Project = { id: string; name: string };

type StatsResponse = {
  anchorDate: string;
  period: Period;
  range: { startDate: string; endDate: string; dayCount: number };
  totalMinutes: number;
  averageMinutes: number;
  rank: { title: string; subtitle: string };
  chartPoints: Array<{ key: string; label: string; minutes: number }>;
  projectBreakdown: Array<{ projectId: string; name: string; minutes: number; percent: number }>;
  selectedComparison: { currentMinutes: number; previousMinutes: number; deltaMinutes: number; percentChange: number | null };
  allComparison: { currentMinutes: number; previousMinutes: number; deltaMinutes: number; percentChange: number | null };
};

const PERIOD_SHIFT: Record<Period, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

function formatDelta(minutes: number) {
  if (minutes > 0) return `+${minutes} min`;
  if (minutes < 0) return `${minutes} min`;
  return "0 min";
}

function formatPercent(value: number | null) {
  if (value === null) return "N/A";
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}min`;
}

function formatRangeLabel(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (startDate === endDate) return fmt.format(start);
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function shiftDateString(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StatsApp({ username }: { username: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [period, setPeriod] = useState<Period>("week");
  const [anchorDate, setAnchorDate] = useState(todayDateString());
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [mobilePicker, setMobilePicker] = useState<"project" | "period" | null>(null);
  const [comparisonsOpen, setComparisonsOpen] = useState(false);
  const [trendOpen, setTrendOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [rankModalOpen, setRankModalOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setProjects(payload.projects || []);
    })();
  }, []);

  useEffect(() => {
    void loadStats();
  }, [projectId, period, anchorDate]);

  async function loadStats() {
    const q = new URLSearchParams({ projectId, period, anchorDate });
    const res = await fetch(`/api/stats?${q.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const payload = (await res.json()) as StatsResponse;
    setStats(payload);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeProjectName =
    projectId === "all" ? "All Projects" : projects.find((project) => project.id === projectId)?.name || "All Projects";
  const periodLabel =
    period === "day" ? "Day" : period === "week" ? "Week (7d)" : period === "month" ? "Month (30d)" : "Year (365d)";

  const chartTitle =
    period === "day" ? "Day Trend" : period === "week" ? "Week Trend" : period === "month" ? "Month Trend" : "Year Trend";

  const chartModel = useMemo(() => {
    const points = stats?.chartPoints ?? [];
    const width = 900;
    const height = 260;
    const left = 36;
    const right = 16;
    const top = 18;
    const bottom = 36;
    const max = Math.max(1, ...points.map((p) => p.minutes));
    const stepX = points.length > 1 ? (width - left - right) / (points.length - 1) : 0;

    const coords = points.map((p, i) => {
      const x = left + i * stepX;
      const y = top + (1 - p.minutes / max) * (height - top - bottom);
      return { x, y, label: p.label, minutes: p.minutes, key: p.key };
    });

    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
    const areaPath = coords.length
      ? `${path} L${coords[coords.length - 1].x},${height - bottom} L${coords[0].x},${height - bottom} Z`
      : "";

    const labelStep = points.length > 120 ? 30 : points.length > 60 ? 14 : points.length > 30 ? 7 : points.length > 14 ? 3 : 1;
    const labels = coords.filter((point, i) => (point.label ? true : i % labelStep === 0 || i === coords.length - 1));

    return { width, height, left, top, bottom, max, coords, path, areaPath, labels };
  }, [stats]);

  return (
    <main className="app-shell stats-shell">
      <section className="timer-card stats-card stats-page-card">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Progress Arena</p>
              <h1>Focus Stats</h1>
              <p className="subtitle">Signed in as {username}</p>
            </div>
            <div className="nav-group">
              <Link className="ghost nav-link" href="/projects">
                Projects
              </Link>
              <Link className="ghost nav-link" href="/history">
                History
              </Link>
              <Link className="ghost nav-link" href="/dashboard">
                Back Timer
              </Link>
              <button className="ghost" onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="filters-row stats-controls-desktop">
          <label className="inline-field inline-grow">
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            Time Period
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="day">Day</option>
              <option value="week">Week (7d)</option>
              <option value="month">Month (30d)</option>
              <option value="year">Year (365d)</option>
            </select>
          </label>
        </section>

        <section className="filters-row period-nav-row stats-controls-desktop">
          <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, -PERIOD_SHIFT[period]))}>
            Previous
          </button>
          {period === "day" ? (
            <>
              <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, -1))}>
                Yesterday
              </button>
              <button className="ghost" onClick={() => setAnchorDate(todayDateString())}>
                Today
              </button>
              <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, 1))}>
                Tomorrow
              </button>
            </>
          ) : (
            <button className="ghost" onClick={() => setAnchorDate(todayDateString())}>
              Current
            </button>
          )}
          <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, PERIOD_SHIFT[period]))}>
            Next
          </button>
        </section>

        <section className="stats-controls-mobile" aria-label="Mobile stats controls">
          <div className="stats-mobile-pickers">
            <button className="ghost stats-picker-btn" onClick={() => setMobilePicker("project")}>
              <span className="stats-picker-label">Project</span>
              <span className="stats-picker-value">{activeProjectName}</span>
            </button>
            <button className="ghost stats-picker-btn" onClick={() => setMobilePicker("period")}>
              <span className="stats-picker-label">Period</span>
              <span className="stats-picker-value">{periodLabel}</span>
            </button>
          </div>
          <div className="stats-mobile-nav">
            <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, -PERIOD_SHIFT[period]))}>
              Prev
            </button>
            <button className="ghost" onClick={() => setAnchorDate(todayDateString())}>
              {period === "day" ? "Today" : "Current"}
            </button>
            <button className="ghost" onClick={() => setAnchorDate(shiftDateString(anchorDate, PERIOD_SHIFT[period]))}>
              Next
            </button>
          </div>
        </section>

        <section className="summary-block">
          <h2>Summary</h2>
          <section className="stats-metrics stats-metrics-summary">
            <article className="metric-card metric-card--full">
              <p>Selected Range</p>
              <h2>{stats ? formatRangeLabel(stats.range.startDate, stats.range.endDate) : "-"}</h2>
            </article>
            <article className="metric-card">
              <p>Total</p>
              <h2>{stats?.totalMinutes ?? 0} min</h2>
            </article>
            <article className="metric-card">
              <p>Avg / day</p>
              <h2>{stats?.averageMinutes ?? 0} min</h2>
            </article>
            <button
              className="metric-card rank-card rank-card--muted rank-card-action metric-card--full"
              onClick={() => setRankModalOpen(true)}
            >
              <p>Current Rank (7d avg) - tap to open ladder</p>
              <h2>{stats?.rank.title ?? "Mortal"}</h2>
              <span>{stats?.rank.subtitle ?? "The journey begins."}</span>
            </button>
          </section>
        </section>

        <section className={`mobile-accordion ${comparisonsOpen ? "is-open" : ""}`}>
          <button className="mobile-accordion-toggle" onClick={() => setComparisonsOpen((v) => !v)}>
            <h2>Comparisons</h2>
            <span>{comparisonsOpen ? "Hide" : "Show"}</span>
          </button>
          <div className="mobile-accordion-body">
            <section className="compare-grid">
              <article className="metric-card">
                <p>Selected scope vs previous {period}</p>
                <h2>{formatDelta(stats?.selectedComparison.deltaMinutes ?? 0)}</h2>
                <span className="metric-note">{formatPercent(stats?.selectedComparison.percentChange ?? null)}</span>
              </article>
              <article className="metric-card">
                <p>All projects vs previous {period}</p>
                <h2>{formatDelta(stats?.allComparison.deltaMinutes ?? 0)}</h2>
                <span className="metric-note">{formatPercent(stats?.allComparison.percentChange ?? null)}</span>
              </article>
            </section>
          </div>
        </section>

        <section className={`mobile-accordion ${trendOpen ? "is-open" : ""}`}>
          <button className="mobile-accordion-toggle" onClick={() => setTrendOpen((v) => !v)}>
            <h2>{chartTitle}</h2>
            <span>{trendOpen ? "Hide" : "Show"}</span>
          </button>
          <div className="mobile-accordion-body">
            <section className="chart-panel">
              <div className="chart-head">
                <p>Y-axis: minutes</p>
              </div>
              <div className="line-chart-wrap">
                <svg className="line-chart" viewBox={`0 0 ${chartModel.width} ${chartModel.height}`} role="img" aria-label="Focus trend chart">
                  <line
                    x1={chartModel.left}
                    y1={chartModel.height - chartModel.bottom}
                    x2={chartModel.width - 8}
                    y2={chartModel.height - chartModel.bottom}
                    className="axis-line"
                  />
                  <line x1={chartModel.left} y1={chartModel.top} x2={chartModel.left} y2={chartModel.height - chartModel.bottom} className="axis-line" />
                  <line
                    x1={chartModel.left}
                    y1={chartModel.top + (chartModel.height - chartModel.top - chartModel.bottom) / 2}
                    x2={chartModel.width - 8}
                    y2={chartModel.top + (chartModel.height - chartModel.top - chartModel.bottom) / 2}
                    className="guide-line"
                  />
                  {chartModel.areaPath ? <path d={chartModel.areaPath} className="trend-area" /> : null}
                  {chartModel.path ? <path d={chartModel.path} className="trend-line" /> : null}
                  {chartModel.coords.map((point) => (
                    <circle key={point.key} cx={point.x} cy={point.y} r={point.minutes > 0 ? 2.8 : 1.8} className="trend-dot">
                      <title>{`${point.key}: ${point.minutes} min`}</title>
                    </circle>
                  ))}
                </svg>
                <div className="y-guides">
                  <span>{chartModel.max}m</span>
                  <span>{Math.floor(chartModel.max / 2)}m</span>
                  <span>0m</span>
                </div>
                <div className="x-labels">
                  {chartModel.labels.map((point) => (
                    <span key={`${point.key}-label`} style={{ left: `${(point.x / chartModel.width) * 100}%` }}>
                      {point.label}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className={`mobile-accordion ${projectsOpen ? "is-open" : ""}`}>
          <button className="mobile-accordion-toggle" onClick={() => setProjectsOpen((v) => !v)}>
            <h2>Projects Worked On</h2>
            <span>{projectsOpen ? "Hide" : "Show"}</span>
          </button>
          <div className="mobile-accordion-body">
            <section className="rank-panel">
              <div className="project-rows">
                {(stats?.projectBreakdown || []).map((item) => (
                  <article key={`pr-${item.projectId}`} className="project-row">
                    <div className="project-row-meta">
                      <strong>{item.name}</strong>
                      <span>
                        {formatHoursMinutes(item.minutes)} {item.percent}%
                      </span>
                    </div>
                    <div className="project-row-bar-track">
                      <div className="project-row-bar-fill" style={{ width: `${Math.max(3, item.percent)}%` }} />
                    </div>
                  </article>
                ))}
                {!stats?.projectBreakdown?.length ? <p className="hint">No projects worked on for this period.</p> : null}
              </div>
            </section>
          </div>
        </section>

        {mobilePicker ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Stats picker">
            <section className="mobile-sheet stats-picker-sheet">
              <header className="modal-head">
                <h2>{mobilePicker === "project" ? "Pick Project" : "Pick Time Period"}</h2>
                <button className="ghost" onClick={() => setMobilePicker(null)}>
                  Close
                </button>
              </header>
              <div className="mobile-project-list">
                {mobilePicker === "project" ? (
                  <>
                    <button
                      className={`project-badge ${projectId === "all" ? "is-active" : ""}`}
                      onClick={() => {
                        setProjectId("all");
                        setMobilePicker(null);
                      }}
                    >
                      All Projects
                    </button>
                    {projects.map((project) => (
                      <button
                        key={`pick-${project.id}`}
                        className={`project-badge ${projectId === project.id ? "is-active" : ""}`}
                        onClick={() => {
                          setProjectId(project.id);
                          setMobilePicker(null);
                        }}
                      >
                        {project.name}
                      </button>
                    ))}
                  </>
                ) : (
                  (["day", "week", "month", "year"] as Period[]).map((p) => (
                    <button
                      key={`period-${p}`}
                      className={`project-badge ${period === p ? "is-active" : ""}`}
                      onClick={() => {
                        setPeriod(p);
                        setMobilePicker(null);
                      }}
                    >
                      {p === "day" ? "Day" : p === "week" ? "Week (7d)" : p === "month" ? "Month (30d)" : "Year (365d)"}
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}

        {rankModalOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rank ladder">
            <section className="side-panel">
              <header className="modal-head">
                <h2>Greek Rank Ladder</h2>
                <button className="ghost" onClick={() => setRankModalOpen(false)}>
                  Close
                </button>
              </header>
              <p className="hint">Current rank: {stats?.rank.title ?? "Mortal"}</p>
              <div className="rank-ladder rank-ladder--single">
                {[...RANK_TIERS].reverse().map((tier) => (
                  <article
                    key={`stats-ladder-${tier.title}`}
                    className={`rank-tier ${stats?.rank.title === tier.title ? "is-active rank-tier--muted-active" : ""}`}
                  >
                    <h3>{tier.title}</h3>
                    <p>{tier.minMinutes}+ min/day avg</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
