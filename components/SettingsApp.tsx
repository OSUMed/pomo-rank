"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SETTINGS_KEY = "pulseSessionSettingsV1";

type SessionSettings = {
  focusMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longEvery: number;
  warmUpMinutes: number;
};

type OuraMetrics = {
  configured: boolean;
  connected: boolean;
  heartRate: number | null;
  heartRateTime: string | null;
  stressState: string | null;
  stressDate: string | null;
};

const DEFAULTS: SessionSettings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  warmUpMinutes: 3,
};

const LIMITS = {
  focusMinutes: { min: 1, max: 90, step: 1, label: "Focus (min)" },
  shortMinutes: { min: 1, max: 30, step: 1, label: "Short Break (min)" },
  longMinutes: { min: 1, max: 45, step: 1, label: "Long Break (min)" },
  longEvery: { min: 2, max: 8, step: 1, label: "Long Break Every (cycles)" },
  warmUpMinutes: { min: 1, max: 20, step: 1, label: "Warm Up Default (min)" },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadSettings(): SessionSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);

    return {
      focusMinutes: clamp(Number(parsed.focusMinutes) || DEFAULTS.focusMinutes, LIMITS.focusMinutes.min, LIMITS.focusMinutes.max),
      shortMinutes: clamp(Number(parsed.shortMinutes) || DEFAULTS.shortMinutes, LIMITS.shortMinutes.min, LIMITS.shortMinutes.max),
      longMinutes: clamp(Number(parsed.longMinutes) || DEFAULTS.longMinutes, LIMITS.longMinutes.min, LIMITS.longMinutes.max),
      longEvery: clamp(Number(parsed.longEvery) || DEFAULTS.longEvery, LIMITS.longEvery.min, LIMITS.longEvery.max),
      warmUpMinutes: clamp(Number(parsed.warmUpMinutes) || DEFAULTS.warmUpMinutes, LIMITS.warmUpMinutes.min, LIMITS.warmUpMinutes.max),
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(settings: SessionSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function stressTone(state: string | null | undefined) {
  const normalized = String(state || "").toLowerCase();
  if (normalized.includes("restore")) return "tone-restored";
  if (normalized.includes("relax")) return "tone-relaxed";
  if (normalized.includes("engag")) return "tone-engaged";
  if (normalized.includes("stress")) return "tone-stressed";
  return "tone-neutral";
}

export function SettingsApp({ username }: { username: string }) {
  const [settings, setSettings] = useState<SessionSettings>(DEFAULTS);
  const [message, setMessage] = useState("");
  const [ouraMetrics, setOuraMetrics] = useState<OuraMetrics | null>(null);
  const [ouraBusy, setOuraBusy] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    void loadOuraMetrics();

    const timer = window.setInterval(() => {
      void loadOuraMetrics();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  async function loadOuraMetrics() {
    const res = await fetch("/api/oura/metrics", { cache: "no-store" });
    if (!res.ok) return;
    const payload = (await res.json()) as OuraMetrics;
    setOuraMetrics(payload);
  }

  async function disconnectOura() {
    setOuraBusy(true);
    const res = await fetch("/api/oura/disconnect", { method: "POST" });
    setOuraBusy(false);

    if (!res.ok) {
      setMessage("Could not disconnect Oura right now.");
      return;
    }

    setMessage("Oura disconnected.");
    await loadOuraMetrics();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function update(key: keyof SessionSettings, nextValue: number) {
    const limit = LIMITS[key];
    setSettings((current) => ({
      ...current,
      [key]: clamp(nextValue, limit.min, limit.max),
    }));
  }

  function apply() {
    saveSettings(settings);
    setMessage("Session settings saved.");
  }

  const keys: Array<keyof SessionSettings> = [
    "focusMinutes",
    "shortMinutes",
    "longMinutes",
    "longEvery",
    "warmUpMinutes",
  ];

  return (
    <main className="app-shell stats-shell">
      <section className="timer-card stats-card">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Session Controls</p>
              <h1>Pomodoro Settings</h1>
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

        <section className="settings-panel settings-page-panel">
          <h2>Oura Integration</h2>
          <article className="metric-card oura-card">
            {!ouraMetrics?.configured ? (
              <p>Oura is not configured for this deployment yet.</p>
            ) : !ouraMetrics.connected ? (
              <>
                <p className="chip-subvalue">Connect your Oura account to show wearable context while you focus.</p>
                <div className="control-row">
                  <a className="primary nav-link" href="/api/oura/connect?next=/settings">
                    Connect Oura Account
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="chip-subvalue">Connected. Oura login + consent is required once to sync data.</p>
                <div className="oura-stats-grid">
                  <article className="stat-chip">
                    <p className="chip-label">Current Heart Rate</p>
                    <p className="chip-value">{ouraMetrics.heartRate ?? "--"} bpm</p>
                  </article>
                  <article className="stat-chip">
                    <p className="chip-label">Current Stress State</p>
                    <p className={`state-pill ${stressTone(ouraMetrics.stressState)}`}>
                      {ouraMetrics.stressState ?? "--"}
                    </p>
                  </article>
                </div>
                <div className="control-row">
                  <button className="ghost" disabled={ouraBusy} onClick={() => void loadOuraMetrics()}>
                    Refresh Oura Data
                  </button>
                  <button className="ghost" disabled={ouraBusy} onClick={() => void disconnectOura()}>
                    Disconnect Oura
                  </button>
                </div>
              </>
            )}
          </article>
        </section>

        <section className="settings-panel settings-page-panel">
          <h2>Session Lengths</h2>
          <div className="step-grid">
            {keys.map((key) => {
              const limit = LIMITS[key];
              const value = settings[key];

              return (
                <article key={key} className="step-card">
                  <p>{limit.label}</p>
                  <div className="step-row">
                    <button className="ghost step-btn" onClick={() => update(key, value - limit.step)}>
                      -
                    </button>
                    <strong>{value}</strong>
                    <button className="ghost step-btn" onClick={() => update(key, value + limit.step)}>
                      +
                    </button>
                  </div>
                  <input
                    type="range"
                    min={limit.min}
                    max={limit.max}
                    step={limit.step}
                    value={value}
                    onChange={(e) => update(key, Number(e.target.value))}
                  />
                </article>
              );
            })}
          </div>
          <div className="control-row">
            <button className="primary" onClick={apply}>
              Save Settings
            </button>
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </section>
      </section>
    </main>
  );
}
