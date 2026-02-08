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

export function SettingsApp({ username }: { username: string }) {
  const [settings, setSettings] = useState<SessionSettings>(DEFAULTS);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

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
