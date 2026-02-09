"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RANK_TIERS } from "@/lib/rank";

type Project = { id: string; name: string };
type Mode = "focus" | "shortBreak" | "longBreak";
type QuickDateMode = "today" | "yesterday" | "custom";

type DashboardSummary = {
  todayMinutes: number;
  sevenDayTotalMinutes: number;
  sevenDayAverageMinutes: number;
  rankTitle: string;
  rankSubtitle: string;
};

type OuraMetrics = {
  configured: boolean;
  connected: boolean;
  heartRate: number | null;
  heartRateTime: string | null;
  stressState: string | null;
  stressDate: string | null;
};

const SETTINGS_KEY = "pulseSessionSettingsV1";

const MODES: Record<Mode, { label: string; color: string; duration: number }> = {
  focus: { label: "Focus time", color: "#ff5d47", duration: 25 * 60 },
  shortBreak: { label: "Short break", color: "#1f84ff", duration: 5 * 60 },
  longBreak: { label: "Long break", color: "#13a172", duration: 15 * 60 },
};

function formatTime(seconds: number) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatMinutesAsHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayDateInputValue() {
  return toDateInputValue(new Date());
}

function stressTone(state: string | null | undefined) {
  const normalized = String(state || "").toLowerCase();
  if (normalized.includes("restore")) return "tone-restored";
  if (normalized.includes("relax")) return "tone-relaxed";
  if (normalized.includes("engag")) return "tone-engaged";
  if (normalized.includes("stress")) return "tone-stressed";
  return "tone-neutral";
}

function yesterdayDateInputValue() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateInputValue(d);
}

function getBadgeStyles(key: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  const hue = Math.abs(hash % 360);

  return {
    "--badge-bg": `hsl(${hue} 92% 94%)`,
    "--badge-border": `hsl(${hue} 60% 74%)`,
    "--badge-text": `hsl(${hue} 50% 30%)`,
    "--badge-active": `hsl(${hue} 75% 52%)`,
  } as CSSProperties;
}

export function DashboardApp({ username }: { username: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("all");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [ouraMetrics, setOuraMetrics] = useState<OuraMetrics | null>(null);
  const [mode, setMode] = useState<Mode>("focus");
  const [remaining, setRemaining] = useState(MODES.focus.duration);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(1);
  const [longEvery, setLongEvery] = useState(4);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [shortMinutes, setShortMinutes] = useState(5);
  const [longMinutes, setLongMinutes] = useState(15);
  const [warmUpMinutes, setWarmUpMinutes] = useState(3);
  const [manualDateMode, setManualDateMode] = useState<QuickDateMode>("today");
  const [customManualDate, setCustomManualDate] = useState(todayDateInputValue());
  const [manualMinutes, setManualMinutes] = useState(25);
  const [manualProjectId, setManualProjectId] = useState<string>("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [message, setMessage] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [rankModalOpen, setRankModalOpen] = useState(false);
  const pendingSecondsRef = useRef(0);

  const durations = useMemo(
    () => ({ focus: focusMinutes * 60, shortBreak: shortMinutes * 60, longBreak: longMinutes * 60 }),
    [focusMinutes, shortMinutes, longMinutes],
  );

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projectQuery, projects]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    void loadOuraMetrics();

    const timer = window.setInterval(() => {
      void loadOuraMetrics();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setFocusMinutes(Math.min(90, Math.max(1, Number(parsed.focusMinutes) || 25)));
      setShortMinutes(Math.min(30, Math.max(1, Number(parsed.shortMinutes) || 5)));
      setLongMinutes(Math.min(45, Math.max(1, Number(parsed.longMinutes) || 15)));
      setLongEvery(Math.min(8, Math.max(2, Number(parsed.longEvery) || 4)));
      setWarmUpMinutes(Math.min(20, Math.max(1, Number(parsed.warmUpMinutes) || 3)));
    } catch {
      // ignore malformed settings
    }
  }, []);

  useEffect(() => {
    setRemaining(durations[mode]);
  }, [durations, mode]);

  useEffect(() => {
    void loadSummary(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (mode === "focus") {
          pendingSecondsRef.current += 1;
          if (pendingSecondsRef.current >= 15) void flushPendingSeconds(projectId);
        }

        if (next <= 0) {
          let nextMode: Mode = "focus";
          let nextCycle = cycle;

          if (mode === "focus") nextMode = cycle % longEvery === 0 ? "longBreak" : "shortBreak";
          else if (mode === "longBreak") {
            nextMode = "focus";
            nextCycle = 1;
          } else {
            nextMode = "focus";
            nextCycle = cycle + 1;
          }

          void flushPendingSeconds(projectId);
          setMode(nextMode);
          setCycle(nextCycle);
          void loadSummary(projectId);
          return durations[nextMode];
        }

        return next;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      void flushPendingSeconds(projectId);
    };
  }, [running, mode, cycle, longEvery, projectId, durations]);

  function resolveManualDate() {
    if (manualDateMode === "today") return todayDateInputValue();
    if (manualDateMode === "yesterday") return yesterdayDateInputValue();
    return customManualDate;
  }

  async function flushPendingSeconds(currentProjectId: string) {
    const amount = pendingSecondsRef.current;
    if (!amount) return;
    pendingSecondsRef.current = 0;

    await fetch("/api/logs/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: amount, projectId: currentProjectId === "all" ? null : currentProjectId }),
    });
  }

  async function loadProjects() {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (!res.ok) return;
    const payload = await res.json();
    const list: Project[] = payload.projects ?? [];
    setProjects(list);

    if (!list.find((p) => p.id === projectId)) {
      setProjectId("all");
      setManualProjectId("all");
    }
  }

  async function loadSummary(nextProjectId: string) {
    const q = new URLSearchParams();
    q.set("projectId", nextProjectId);

    const res = await fetch(`/api/dashboard?${q.toString()}`, { cache: "no-store" });
    if (!res.ok) return;

    const payload = (await res.json()) as DashboardSummary;
    setSummary(payload);
  }

  async function loadOuraMetrics() {
    const res = await fetch("/api/oura/metrics", { cache: "no-store" });
    if (!res.ok) return;
    const payload = (await res.json()) as OuraMetrics;
    setOuraMetrics(payload);
  }

  async function addManualLog() {
    const res = await fetch("/api/logs/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: resolveManualDate(),
        minutes: manualMinutes,
        projectId: manualProjectId === "all" ? null : manualProjectId,
      }),
    });

    if (!res.ok) {
      setMessage("Could not add manual log.");
      return false;
    }

    setMessage("Manual log added.");
    await loadSummary(projectId);
    return true;
  }

  async function logout() {
    await flushPendingSeconds(projectId);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeMode = MODES[mode];
  const ringOffset = 590 * (1 - remaining / (durations[mode] || 1));

  return (
    <main className="app-shell">
      <section className="timer-card" aria-label="Pomodoro tracker">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Focus Toolkit</p>
              <h1>Pulse Pomodoro</h1>
              <p className="subtitle">Signed in as {username}</p>
            </div>
            <div className="nav-group">
              <button
                className="primary quick-header-btn"
                onClick={() => {
                  setManualProjectId(projectId);
                  setProjectQuery("");
                  setManualModalOpen(true);
                }}
              >
                Quick Add Log
              </button>
              <Link className="ghost nav-link" href="/settings">
                Settings
              </Link>
              <Link className="ghost nav-link" href="/projects">
                Projects
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

        <nav className="mode-switch" aria-label="Timer mode">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button
              key={m}
              className={`mode-btn ${mode === m ? "is-active" : ""}`}
              onClick={async () => {
                await flushPendingSeconds(projectId);
                setMode(m);
                setRunning(false);
                setRemaining(durations[m]);
              }}
            >
              {m === "focus" ? "Focus" : m === "shortBreak" ? "Short Break" : "Long Break"}
            </button>
          ))}
        </nav>

        <section className={`session-stage ${running ? "is-running" : ""}`}>
          <section className="clock-wrap" aria-live="polite">
            <svg className="progress-ring" viewBox="0 0 220 220" role="img" aria-label="Timer progress">
              <circle className="progress-ring__track" cx="110" cy="110" r="94" />
              <circle
                className="progress-ring__bar"
                cx="110"
                cy="110"
                r="94"
                style={{ stroke: activeMode.color, strokeDasharray: 590, strokeDashoffset: ringOffset }}
              />
            </svg>
            <div className="clock-text">
              <p>{activeMode.label}</p>
              <p className="time-display">{formatTime(Math.max(0, remaining))}</p>
              <p>
                Cycle {cycle} of {longEvery}
              </p>
            </div>
          </section>
        </section>

        <section className="control-row">
          <button className="primary" onClick={() => setRunning((v) => !v)}>
            {running ? "Pause" : "Start"}
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await flushPendingSeconds(projectId);
              setMode("focus");
              setRunning(false);
              setRemaining(warmUpMinutes * 60);
            }}
          >
            Warm Up ({warmUpMinutes}m)
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await flushPendingSeconds(projectId);
              setMode("focus");
              setRunning(false);
              setRemaining(durations.focus);
            }}
          >
            Default Time
          </button>
          <button className="ghost" onClick={() => setRemaining((prev) => prev + 5 * 60)}>
            +5 min
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await flushPendingSeconds(projectId);
              setRunning(false);
              setRemaining(durations[mode]);
            }}
          >
            Reset
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await flushPendingSeconds(projectId);
              setMode(mode === "focus" ? "shortBreak" : "focus");
            }}
          >
            Skip
          </button>
        </section>

        <section className="project-panel project-panel-bottom" aria-label="Project tags">
          <div className="inline-field inline-grow">
            <label>Select Project:</label>
            <div className="badge-picker">
              <button
                className={`project-badge ${projectId === "all" ? "is-active" : ""}`}
                style={getBadgeStyles("all")}
                onClick={async () => {
                  await flushPendingSeconds(projectId);
                  setProjectId("all");
                }}
              >
                No Project
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={`project-badge ${projectId === project.id ? "is-active" : ""}`}
                  style={getBadgeStyles(project.name)}
                  onClick={async () => {
                    await flushPendingSeconds(projectId);
                    setProjectId(project.id);
                  }}
                >
                  {project.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="live-stats">
          <article className="stat-chip">
            <p className="chip-label">Today</p>
            <p className="chip-value">{summary?.todayMinutes ?? 0} min</p>
          </article>
          <article className="stat-chip">
            <p className="chip-label">Oura Live</p>
            {!ouraMetrics?.configured ? (
              <p className="chip-subvalue">Set Oura env vars to enable wearable stats.</p>
            ) : !ouraMetrics.connected ? (
              <a className="ghost chip-action-link" href="/api/oura/connect">
                Connect Oura
              </a>
            ) : (
              <>
                <p className="chip-value">{ouraMetrics.heartRate ?? "--"} bpm</p>
                <p className="chip-subvalue">Current heart rate</p>
                <p className={`state-pill ${stressTone(ouraMetrics.stressState)}`}>
                  Current Stress: {ouraMetrics.stressState ?? "--"}
                </p>
              </>
            )}
          </article>
          <button className="stat-chip rank-chip-btn" onClick={() => setRankModalOpen(true)}>
            <p className="chip-label">7-Day Rank (tap for ladder)</p>
            <p className="chip-value">{summary?.rankTitle ?? "Mortal"}</p>
            <p className="chip-subvalue">
              Current 7-day average: {formatMinutesAsHours(summary?.sevenDayAverageMinutes ?? 0)} / day
            </p>
            <p className="chip-subvalue">
              Current 7-day total: {formatMinutesAsHours(summary?.sevenDayTotalMinutes ?? 0)}
            </p>
          </button>
        </section>

        {message ? <p className="hint top-message">{message}</p> : null}
      </section>

      {manualModalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Manual log popup">
          <section className="modal-card">
            <header className="modal-head">
              <h2>Quick Manual Log</h2>
              <button className="ghost" onClick={() => setManualModalOpen(false)}>
                Close
              </button>
            </header>
            <div className="preset-row">
              {[20, 30, 60].map((value) => (
                <button key={value} className="ghost preset-btn" onClick={() => setManualMinutes(value)}>
                  {value === 60 ? "1 hour" : `${value} min`}
                </button>
              ))}
            </div>
            <div className="manual-log-grid">
              <label>
                Minutes
                <input
                  type="number"
                  min={1}
                  max={960}
                  value={manualMinutes}
                  onChange={(e) => setManualMinutes(Number(e.target.value))}
                />
              </label>
              <div className="inline-field">
                <label>Date</label>
                <div className="date-toggle-row">
                  <button
                    className={`date-toggle-btn ${manualDateMode === "today" ? "is-active" : ""}`}
                    onClick={() => setManualDateMode("today")}
                  >
                    Today
                  </button>
                  <button
                    className={`date-toggle-btn ${manualDateMode === "yesterday" ? "is-active" : ""}`}
                    onClick={() => setManualDateMode("yesterday")}
                  >
                    Yesterday
                  </button>
                  <button
                    className={`date-toggle-btn ${manualDateMode === "custom" ? "is-active" : ""}`}
                    onClick={() => setManualDateMode("custom")}
                  >
                    Custom
                  </button>
                </div>
                {manualDateMode === "custom" ? (
                  <input type="date" value={customManualDate} onChange={(e) => setCustomManualDate(e.target.value)} />
                ) : null}
              </div>
            </div>
            <div className="inline-field">
              <label>Find Project</label>
              <input value={projectQuery} onChange={(e) => setProjectQuery(e.target.value)} placeholder="Search projects" />
            </div>
            <div className="badge-picker modal-project-picker">
              <button
                className={`project-badge ${manualProjectId === "all" ? "is-active" : ""}`}
                style={getBadgeStyles("all")}
                onClick={() => setManualProjectId("all")}
              >
                No Project
              </button>
              {filteredProjects.map((project) => (
                <button
                  key={`manual-${project.id}`}
                  className={`project-badge ${manualProjectId === project.id ? "is-active" : ""}`}
                  style={getBadgeStyles(project.name)}
                  onClick={() => setManualProjectId(project.id)}
                >
                  {project.name}
                </button>
              ))}
            </div>
            <div className="control-row modal-actions">
              <button
                className="primary"
                onClick={async () => {
                  const ok = await addManualLog();
                  if (ok) setManualModalOpen(false);
                }}
              >
                Save Log
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {rankModalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rank ladder panel">
          <section className="side-panel">
            <header className="modal-head">
              <h2>Greek Rank Ladder</h2>
              <button className="ghost" onClick={() => setRankModalOpen(false)}>
                Close
              </button>
            </header>
            <p className="hint">Current rank: {summary?.rankTitle ?? "Mortal"}</p>
            <div className="rank-ladder rank-ladder--single">
              {[...RANK_TIERS].reverse().map((tier) => (
                <article key={`dialog-${tier.title}`} className={`rank-tier ${summary?.rankTitle === tier.title ? "is-active" : ""}`}>
                  <h3>{tier.title}</h3>
                  <p>{tier.minMinutes}+ min/day avg</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
