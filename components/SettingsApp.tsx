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
  missing?: string[];
  connected: boolean;
  heartRateSamples: Array<{ timestamp: string; bpm: number }>;
  latestHeartRate: number | null;
  latestHeartRateTime: string | null;
  stressToday: {
    date: string | null;
    stressedHours: number;
    engagedHours: number;
    relaxedHours: number;
    restoredHours: number;
  } | null;
  profile: {
    baselineMedianBpm: number | null;
    typicalDriftBpm: number | null;
    sampleCount: number;
  };
  warning?: string | null;
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

function formatSampleTime(value: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(dt);
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

export function SettingsApp({ username }: { username: string }) {
  const [settings, setSettings] = useState<SessionSettings>(DEFAULTS);
  const [message, setMessage] = useState("");
  const [ouraMetrics, setOuraMetrics] = useState<OuraMetrics | null>(null);
  const [ouraBusy, setOuraBusy] = useState(false);
  const [ouraLoading, setOuraLoading] = useState(true);
  const [ouraError, setOuraError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    void loadOuraMetrics();
    handleOuraRedirectState();

    const timer = window.setInterval(() => {
      void loadOuraMetrics();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  async function loadOuraMetrics() {
    setOuraLoading(true);
    setOuraError(null);
    const res = await fetch("/api/oura/metrics", { cache: "no-store" });
    const payload = (await res.json()) as OuraMetrics & { error?: string };
    if (!res.ok) {
      console.error("Oura metrics load failed", payload);
      setOuraError(payload.error || "Failed to load Oura metrics.");
      setOuraLoading(false);
      return;
    }
    setOuraMetrics(payload);
    setOuraLoading(false);
  }

  function handleOuraRedirectState() {
    const params = new URLSearchParams(window.location.search);
    const ouraState = params.get("oura");
    const ouraReason = params.get("oura_reason");
    const connectedCookie = document.cookie.includes("oura_connected=1");

    if (connectedCookie) {
      setMessage("Oura connected successfully.");
      document.cookie = "oura_connected=; Max-Age=0; path=/; SameSite=Lax";
    }

    if (ouraState === "invalid_state") {
      setMessage("Oura connection expired. Please try connecting again.");
    } else if (ouraState === "connect_failed") {
      setMessage(ouraReason ? `Oura login failed: ${ouraReason}` : "Oura login failed. Please try again.");
    } else if (ouraState === "config_missing") {
      setMessage("Oura setup is missing in deployment env vars. Add OURA_CLIENT_ID/SECRET/REDIRECT_URI.");
    }

    if (ouraState) {
      params.delete("oura");
      params.delete("oura_reason");
      const cleaned = params.toString();
      const url = `${window.location.pathname}${cleaned ? `?${cleaned}` : ""}`;
      window.history.replaceState({}, "", url);
    }
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
            {ouraLoading ? (
              <p className="chip-subvalue">Loading Oura metrics...</p>
            ) : ouraError ? (
              <>
                <p className="error-text">Could not load Oura metrics right now.</p>
                <p className="chip-subvalue">{ouraError}</p>
                <div className="control-row">
                  <button className="ghost" onClick={() => void loadOuraMetrics()}>
                    Retry
                  </button>
                </div>
              </>
            ) : !ouraMetrics?.configured ? (
              <>
                <p>Oura is not configured for this deployment yet.</p>
                <p className="chip-subvalue">
                  Set `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, and `OURA_REDIRECT_URI` in your current environment, then reconnect here.
                </p>
                {ouraMetrics?.missing?.length ? (
                  <p className="chip-subvalue">Missing: {ouraMetrics.missing.join(", ")}</p>
                ) : null}
                <div className="control-row">
                  <a className="ghost nav-link" href="/api/oura/connect?next=/settings">
                    Retry Oura Connect
                  </a>
                </div>
              </>
            ) : !ouraMetrics.connected ? (
              <>
                <p className="chip-subvalue">Connect your Oura account to show wearable context while you focus.</p>
                {ouraMetrics.warning ? <p className="error-text">{ouraMetrics.warning}</p> : null}
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
                    <p className="chip-label">Current HR</p>
                    <p className="chip-value">{ouraMetrics.latestHeartRate ?? "--"} bpm</p>
                    <p className="chip-subvalue">Last sample: {formatSampleTime(ouraMetrics.latestHeartRateTime)}</p>
                  </article>
                  <article className="stat-chip">
                    <p className="chip-label">Today Stress</p>
                    {ouraMetrics.stressToday ? (
                      <>
                        <p className="chip-value">{ouraMetrics.stressToday.stressedHours}h stressed</p>
                        <p className="chip-subvalue">
                          Engaged {ouraMetrics.stressToday.engagedHours}h · Relaxed {ouraMetrics.stressToday.relaxedHours}h · Restored{" "}
                          {ouraMetrics.stressToday.restoredHours}h
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="chip-value">--</p>
                        <p className="chip-subvalue">No daily stress samples yet.</p>
                      </>
                    )}
                  </article>
                </div>
                <p className="chip-subvalue">
                  Adaptive baseline training: {ouraMetrics.profile.baselineMedianBpm ?? "--"} bpm · Samples {ouraMetrics.profile.sampleCount}
                </p>
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
