"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type HistoryLog = {
  id: string;
  projectId: string | null;
  projectName: string;
  logDate: string;
  seconds: number;
  source: "timer" | "manual";
  createdAt: string;
};

function formatDuration(seconds: number) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function formatTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(dt);
}

export function HistoryApp({ username }: { username: string }) {
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadLogs();
  }, []);

  async function loadLogs() {
    setBusy(true);
    const res = await fetch("/api/logs/recent?date=today&limit=30", { cache: "no-store" });
    const payload = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(payload?.error || "Could not load history.");
      return;
    }
    setLogs(payload.logs || []);
  }

  async function removeLog(logId: string) {
    const res = await fetch(`/api/logs/${logId}`, { method: "DELETE" });
    const payload = await res.json();
    if (!res.ok) {
      setMessage(payload?.error || "Could not delete session.");
      return;
    }
    setMessage("Session deleted.");
    await loadLogs();
  }

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
              <p className="eyebrow">Session Cleanup</p>
              <h1>Today History</h1>
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

        <section className="settings-panel">
          <h2>Last 30 entries (today)</h2>
          <p className="hint">You can delete only your most recent 30 sessions.</p>
          {busy ? <p className="hint">Loading...</p> : null}
          <div className="history-list">
            {logs.map((log) => (
              <article key={log.id} className="history-row">
                <div className="history-meta">
                  <strong>{log.projectName}</strong>
                  <span>{formatDuration(log.seconds)}</span>
                </div>
                <div className="history-submeta">
                  <span>{log.source === "manual" ? "Manual" : "Timer"} · {formatTime(log.createdAt)} PST</span>
                  <button className="ghost" onClick={() => void removeLog(log.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {!busy && !logs.length ? <p className="hint">No logs for today yet.</p> : null}
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </section>
      </section>
    </main>
  );
}
