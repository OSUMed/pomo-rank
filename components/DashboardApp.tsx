"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RANK_TIERS } from "@/lib/rank";

type Project = { id: string; name: string; color: string | null };
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

const SETTINGS_KEY = "pulseSessionSettingsV1";
const LAST_RANK_KEY = "pulseLastAllRankTitle";
const OURA_POLL_INTERVAL_MS = 60 * 1000;
const FOCUS_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_PROJECT_COLOR = "#2b5d8b";
const UNSELECTED_PROJECT_DOT = "#9ca3af";

type RankChangeState = {
  direction: "up" | "down";
  from: string;
  to: string;
} | null;

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
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m}min`;
}

function formatTimestampLabel(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayDateInputValue() {
  return toDateInputValue(new Date());
}

type FocusSignal = "steady" | "slow_down" | "take_break";

function signalTone(state: FocusSignal) {
  if (state === "steady") return "tone-restored";
  if (state === "slow_down") return "tone-engaged";
  return "tone-stressed";
}

function toMillis(ts: string) {
  const value = new Date(ts).getTime();
  return Number.isFinite(value) ? value : 0;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeRollingFiveMinuteAvg(samples: Array<{ timestamp: string; bpm: number }>) {
  if (!samples.length) return null;
  const latestTs = toMillis(samples[samples.length - 1].timestamp);
  const windowStart = latestTs - FOCUS_WINDOW_MS;
  const values = samples.filter((sample) => toMillis(sample.timestamp) >= windowStart).map((sample) => sample.bpm);
  return average(values);
}

function computeSessionStartBaseline(samples: Array<{ timestamp: string; bpm: number }>, startedAt: string) {
  const startMs = toMillis(startedAt);
  if (!startMs) return null;
  const endMs = startMs + FOCUS_WINDOW_MS;
  const values = samples
    .filter((sample) => {
      const ts = toMillis(sample.timestamp);
      return ts >= startMs && ts <= endMs;
    })
    .map((sample) => sample.bpm);
  if (values.length < 3) return null;
  return average(values);
}

function yesterdayDateInputValue() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateInputValue(d);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function shiftRgb(rgb: { r: number; g: number; b: number }, amount: number) {
  return {
    r: clamp(rgb.r + amount, 0, 255),
    g: clamp(rgb.g + amount, 0, 255),
    b: clamp(rgb.b + amount, 0, 255),
  };
}

function rgbToCss(rgb: { r: number; g: number; b: number }, alpha = 1) {
  if (alpha >= 1) return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`;
}

function projectDotColor(project?: Project | null) {
  return project?.color || UNSELECTED_PROJECT_DOT;
}

export function DashboardApp({ username }: { username: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("all");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [ouraMetrics, setOuraMetrics] = useState<OuraMetrics | null>(null);
  const [ouraError, setOuraError] = useState<string | null>(null);
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
  const [rankChange, setRankChange] = useState<RankChangeState>(null);
  const [recoveryReason, setRecoveryReason] = useState<string | null>(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileProjectPickerOpen, setMobileProjectPickerOpen] = useState(false);
  const [bioDetailsOpen, setBioDetailsOpen] = useState(false);
  const [focusSignal, setFocusSignal] = useState<FocusSignal>("steady");
  const [rollingAvgBpm, setRollingAvgBpm] = useState<number | null>(null);
  const [sessionBaselineBpm, setSessionBaselineBpm] = useState<number | null>(null);
  const [consecutiveHighWindows, setConsecutiveHighWindows] = useState(0);
  const pendingSecondsRef = useRef(0);
  const focusSessionStartedAtRef = useRef<string | null>(null);
  const previousFocusRunningRef = useRef(false);
  const peakRollingBpmRef = useRef<number | null>(null);
  const rollingTotalRef = useRef(0);
  const rollingCountRef = useRef(0);
  const alertWindowsRef = useRef(0);
  const nextRecoveryAlertAtRef = useRef(0);

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
    if (!summary?.rankTitle || projectId !== "all") return;

    const previous = localStorage.getItem(LAST_RANK_KEY);
    const current = summary.rankTitle;

    if (previous && previous !== current) {
      const previousIndex = RANK_TIERS.findIndex((tier) => tier.title === previous);
      const currentIndex = RANK_TIERS.findIndex((tier) => tier.title === current);

      if (previousIndex >= 0 && currentIndex >= 0) {
        setRankChange({
          direction: currentIndex > previousIndex ? "up" : "down",
          from: previous,
          to: current,
        });
      }
    }

    localStorage.setItem(LAST_RANK_KEY, current);
  }, [summary?.rankTitle, projectId]);

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

  useEffect(() => {
    const isFocusRunning = running && mode === "focus";
    if (isFocusRunning && !previousFocusRunningRef.current) {
      const startedAt = new Date().toISOString();
      focusSessionStartedAtRef.current = startedAt;
      setSessionBaselineBpm(null);
      setRollingAvgBpm(null);
      setConsecutiveHighWindows(0);
      setFocusSignal("steady");
      peakRollingBpmRef.current = null;
      rollingTotalRef.current = 0;
      rollingCountRef.current = 0;
      alertWindowsRef.current = 0;
    }

    if (!isFocusRunning && previousFocusRunningRef.current) {
      void persistFocusTelemetry();
      focusSessionStartedAtRef.current = null;
      setConsecutiveHighWindows(0);
    }

    previousFocusRunningRef.current = isFocusRunning;
  }, [running, mode]);

  useEffect(() => {
    const tick = () => {
      void loadOuraMetrics(running && mode === "focus" ? focusSessionStartedAtRef.current : null);
    };

    tick();
    const timer = window.setInterval(tick, OURA_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, mode]);

  useEffect(() => {
    if (!ouraMetrics?.connected) return;
    const rolling = computeRollingFiveMinuteAvg(ouraMetrics.heartRateSamples);
    setRollingAvgBpm(rolling);
    if (!rolling) {
      setFocusSignal("steady");
      return;
    }

    const isFocusRunning = running && mode === "focus" && Boolean(focusSessionStartedAtRef.current);
    const baselineNow =
      (isFocusRunning && focusSessionStartedAtRef.current
        ? sessionBaselineBpm ??
          computeSessionStartBaseline(ouraMetrics.heartRateSamples, focusSessionStartedAtRef.current) ??
          null
        : null) ?? sessionBaselineBpm;
    if (baselineNow && !sessionBaselineBpm) setSessionBaselineBpm(baselineNow);

    const effectiveBaseline = baselineNow ?? ouraMetrics.profile.baselineMedianBpm ?? rolling;
    if (!effectiveBaseline || !rolling) return;

    const drift = ouraMetrics.profile.typicalDriftBpm ?? 8;
    const thresholdDelta = Math.max(6, drift + 2);
    const threshold = effectiveBaseline + thresholdDelta;
    const above = rolling > threshold;

    if (!isFocusRunning) {
      setConsecutiveHighWindows(0);
      setFocusSignal(above ? "slow_down" : "steady");
      return;
    }

    if (above) {
      setConsecutiveHighWindows((prev) => {
        const next = prev + 1;
        alertWindowsRef.current += 1;
        if (next === 1) setFocusSignal("slow_down");
        if (next >= 2 && Date.now() > nextRecoveryAlertAtRef.current) {
          setFocusSignal("take_break");
          setRunning(false);
          setRecoveryReason(
            "Your heart rate has stayed elevated above your session baseline. Take a short recovery break.",
          );
          nextRecoveryAlertAtRef.current = Date.now() + 10 * 60 * 1000;
        }
        return next;
      });
    } else {
      setConsecutiveHighWindows(0);
      setFocusSignal("steady");
    }

    peakRollingBpmRef.current = Math.max(peakRollingBpmRef.current ?? rolling, rolling);
    rollingTotalRef.current += rolling;
    rollingCountRef.current += 1;
  }, [ouraMetrics, running, mode, sessionBaselineBpm]);

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

  async function changeProject(nextProjectId: string) {
    await flushPendingSeconds(projectId);
    setProjectId(nextProjectId);
  }

  async function loadSummary(nextProjectId: string) {
    const q = new URLSearchParams();
    q.set("projectId", nextProjectId);

    const res = await fetch(`/api/dashboard?${q.toString()}`, { cache: "no-store" });
    if (!res.ok) return;

    const payload = (await res.json()) as DashboardSummary;
    setSummary(payload);
  }

  async function loadOuraMetrics(focusStart?: string | null) {
    setOuraError(null);
    const query = new URLSearchParams();
    if (focusStart) query.set("focusStart", focusStart);
    const url = query.toString() ? `/api/oura/metrics?${query.toString()}` : "/api/oura/metrics";
    const res = await fetch(url, { cache: "no-store" });
    const payload = (await res.json()) as OuraMetrics & { error?: string };
    if (!res.ok) {
      setOuraError(payload.error || "Could not fetch Oura metrics.");
      return;
    }
    setOuraMetrics(payload);
  }

  async function persistFocusTelemetry() {
    const startedAt = focusSessionStartedAtRef.current;
    const endedAt = new Date().toISOString();
    const baseline = sessionBaselineBpm ?? ouraMetrics?.profile.baselineMedianBpm ?? null;
    const peak = peakRollingBpmRef.current;
    const avg =
      rollingCountRef.current > 0
        ? rollingTotalRef.current / rollingCountRef.current
        : null;

    if (!startedAt || !baseline || !peak || !avg) return;

    await fetch("/api/oura/focus-telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionStartedAt: startedAt,
        sessionEndedAt: endedAt,
        baselineBpm: baseline,
        peakRollingBpm: peak,
        avgRollingBpm: avg,
        alertWindows: alertWindowsRef.current,
      }),
    });
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
  const stressTodaySummary = ouraMetrics?.stressToday
    ? `Today: Stressed ${ouraMetrics.stressToday.stressedHours}h`
    : "Today: No stress data";
  const activeProject = projectId === "all" ? null : projects.find((p) => p.id === projectId) || null;
  const activeProjectName = activeProject?.name || "No Project";
  const displayRollingAvgBpm = rollingAvgBpm ?? computeRollingFiveMinuteAvg(ouraMetrics?.heartRateSamples ?? []);
  const displayBaselineBpm = sessionBaselineBpm ?? ouraMetrics?.profile.baselineMedianBpm ?? null;
  const timerAccentColor = mode === "focus" ? activeProject?.color || DEFAULT_PROJECT_COLOR : activeMode.color;
  const timerAccentRgb = timerAccentColor ? hexToRgb(timerAccentColor) : null;
  const timerCardStyle = timerAccentRgb
    ? ({
        "--accent": timerAccentColor,
        "--accent-soft": rgbToCss(shiftRgb(timerAccentRgb, 24)),
        "--track": rgbToCss(shiftRgb(timerAccentRgb, 165), 0.52),
        "--accent-shadow": rgbToCss(timerAccentRgb, 0.34),
        "--accent-glow": rgbToCss(timerAccentRgb, 0.12),
      } as CSSProperties)
    : undefined;

  return (
    <main className="app-shell">
      <section className="timer-card" style={timerCardStyle} aria-label="Pomodoro tracker">
        <header className="heading-block">
          <div className="header-row">
            <div>
              <p className="eyebrow">Focus Toolkit</p>
              <h1>Pulse Pomodoro</h1>
              <p className="subtitle">Signed in as {username}</p>
            </div>
          </div>
          <div className="nav-group nav-group-row">
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
          <div className="header-mobile-actions">
            <button
              className="primary quick-header-btn quick-header-btn-mobile"
              onClick={() => {
                setManualProjectId(projectId);
                setProjectQuery("");
                setManualModalOpen(true);
              }}
            >
              Quick Add Log
            </button>
            <div className="mobile-menu-wrap">
              <button className="ghost mobile-menu-toggle" onClick={() => setMobileMenuOpen((v) => !v)}>
                Menu
              </button>
              {mobileMenuOpen ? (
                <div className="mobile-nav-panel">
                  <Link className="mobile-nav-item" href="/settings" onClick={() => setMobileMenuOpen(false)}>
                    Settings
                  </Link>
                  <Link className="mobile-nav-item" href="/projects" onClick={() => setMobileMenuOpen(false)}>
                    Projects
                  </Link>
                  <Link className="mobile-nav-item" href="/stats" onClick={() => setMobileMenuOpen(false)}>
                    Stats
                  </Link>
                  <button
                    className="mobile-nav-item"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void logout();
                    }}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
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
                style={{ stroke: timerAccentColor, strokeDasharray: 590, strokeDashoffset: ringOffset }}
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

        <section className="control-row control-row-desktop">
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
        <section className="control-row-mobile" aria-label="Mobile timer controls">
          <button className="primary" onClick={() => setRunning((v) => !v)}>
            {running ? "Pause" : "Start"}
          </button>
          <button className="ghost mobile-tools-toggle" onClick={() => setMobileToolsOpen((v) => !v)}>
            {mobileToolsOpen ? "Hide Controls" : "More Controls"}
          </button>
              {mobileToolsOpen ? (
            <div className="mobile-tools-panel">
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
              <button className="ghost" onClick={() => setRemaining((prev) => prev + 5 * 60)}>
                +5 min
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
                Cancel
              </button>
            </div>
          ) : null}
        </section>

        <section className="project-panel project-panel-bottom" aria-label="Project tags">
          <div className="inline-field inline-grow">
         
            <div className="badge-picker project-scroll-picker">
              <h3>Select Project:</h3>
              <button
                className={`project-badge ${projectId === "all" ? "is-active" : ""}`}
                onClick={() => void changeProject("all")}
              >
                <span className="project-badge-dot" style={{ background: UNSELECTED_PROJECT_DOT }} />
                No Project
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={`project-badge ${projectId === project.id ? "is-active" : ""}`}
                  onClick={() => void changeProject(project.id)}
                >
                  <span className="project-badge-dot" style={{ background: projectDotColor(project) }} />
                  {project.name}
                </button>
              ))}
            </div>
            <div className="project-picker-mobile">
              <button
                className="project-mobile-trigger"
                onClick={() => setMobileProjectPickerOpen(true)}
              >
                <span className="project-mobile-label">Project</span>
                <span className="project-mobile-main">
                  <span className="project-mobile-main-left">
                    <span className="project-badge-dot" style={{ background: projectDotColor(activeProject) }} />
                    <span className="project-mobile-value">{activeProjectName}</span>
                  </span>
                  <span className="project-mobile-chevron">Change</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        <section className="live-stats">
          <article className="stat-chip">
            <p className="chip-label">Today</p>
            <p className="chip-value">{formatMinutesAsHours(summary?.todayMinutes ?? 0)}</p>
          </article>
          <article className="stat-chip">
            <p className="chip-label">Focus Biofeedback</p>
            {ouraError ? (
              <>
                <p className="chip-subvalue">Oura data unavailable right now.</p>
                <p className="chip-subvalue">{ouraError}</p>
              </>
            ) : !ouraMetrics ? (
              <p className="chip-subvalue">Loading Oura metrics...</p>
            ) : !ouraMetrics.configured ? (
              <p className="chip-subvalue">Set Oura env vars to enable wearable stats.</p>
            ) : !ouraMetrics.connected ? (
              <>
                {ouraMetrics.warning ? <p className="chip-subvalue">{ouraMetrics.warning}</p> : null}
                <a className="ghost chip-action-link" href="/api/oura/connect?next=/settings">
                  Connect Oura
                </a>
              </>
            ) : (
              <>
                <div className="bio-desktop">
                  <p className={`state-pill signal-pill signal-pill--primary ${signalTone(focusSignal)}`}>
                    {focusSignal === "steady" ? "● Focus steady" : focusSignal === "slow_down" ? "◐ Slow down" : "▲ Take a break"}
                  </p>
                  <div className="bio-metrics-grid">
                    <span className="bio-metric-pill">Current HR: {ouraMetrics.latestHeartRate ?? "--"} bpm</span>
                    <span className="bio-metric-pill">Rolling 5-min avg: {displayRollingAvgBpm ? Math.round(displayRollingAvgBpm) : "--"} bpm</span>
                    <span className="bio-metric-pill">
                      Baseline: {displayBaselineBpm ? Math.round(displayBaselineBpm) : "--"} bpm
                    </span>
                    <span className="bio-metric-pill">High windows: {consecutiveHighWindows}</span>
                  </div>
                </div>
                <div className="bio-mobile">
                  <button className="bio-mobile-row" onClick={() => setBioDetailsOpen((v) => !v)}>
                    <span className={`state-pill signal-pill ${signalTone(focusSignal)}`}>
                      {focusSignal === "steady" ? "Focus steady" : focusSignal === "slow_down" ? "Slow down" : "Take a break"}
                    </span>
                    <span className="bio-mobile-summary">{stressTodaySummary}</span>
                    <span className="bio-mobile-chevron">{bioDetailsOpen ? "Hide" : "Details"}</span>
                  </button>
                  {bioDetailsOpen ? (
                    <div className="bio-mobile-details">
                      <div className="bio-metrics-grid">
                        <span className="bio-metric-pill">Current HR: {ouraMetrics.latestHeartRate ?? "--"} bpm</span>
                        <span className="bio-metric-pill">Rolling 5-min avg: {displayRollingAvgBpm ? Math.round(displayRollingAvgBpm) : "--"} bpm</span>
                        <span className="bio-metric-pill">
                          Baseline: {displayBaselineBpm ? Math.round(displayBaselineBpm) : "--"} bpm
                        </span>
                        <span className="bio-metric-pill">High windows: {consecutiveHighWindows}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                {!ouraMetrics.heartRateSamples.length ? (
                  <p className="chip-subvalue">
                    Waiting for Oura heart-rate samples (can be delayed). Press Start Focus, wear your ring, and sync Oura.
                  </p>
                ) : null}
                <p className="chip-subvalue">Last HR sample: {formatTimestampLabel(ouraMetrics.latestHeartRateTime)}</p>
                {!running || mode !== "focus" ? (
                  <p className="chip-subvalue">Auto-pause nudges activate during Focus runs; live HR status works anytime.</p>
                ) : null}
                {ouraMetrics.stressToday ? (
                  <div className="stress-context">
                    <p className="chip-label">Today so far</p>
                    <div className="stress-chip-row">
                      <span className="stress-chip">Stressed · {ouraMetrics.stressToday.stressedHours}h</span>
                      <span className="stress-chip">Engaged · {ouraMetrics.stressToday.engagedHours}h</span>
                      <span className="stress-chip">Relaxed · {ouraMetrics.stressToday.relaxedHours}h</span>
                      <span className="stress-chip">Restored · {ouraMetrics.stressToday.restoredHours}h</span>
                    </div>
                  </div>
                ) : null}
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
                onClick={() => setManualProjectId("all")}
              >
                <span className="project-badge-dot" style={{ background: UNSELECTED_PROJECT_DOT }} />
                No Project
              </button>
              {filteredProjects.map((project) => (
                <button
                  key={`manual-${project.id}`}
                  className={`project-badge ${manualProjectId === project.id ? "is-active" : ""}`}
                  onClick={() => setManualProjectId(project.id)}
                >
                  <span className="project-badge-dot" style={{ background: projectDotColor(project) }} />
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

      {recoveryReason ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Recovery pause recommendation">
          <section className="modal-card recovery-card">
            <header className="modal-head">
              <h2>Break Recommended</h2>
              <button className="ghost" onClick={() => setRecoveryReason(null)}>
                Close
              </button>
            </header>
            <p className="rank-change-copy">{recoveryReason}</p>
            <div className="control-row modal-actions">
              <button
                className="primary"
                onClick={async () => {
                  await flushPendingSeconds(projectId);
                  setMode("shortBreak");
                  setRemaining(durations.shortBreak);
                  setRecoveryReason(null);
                }}
              >
                Start Short Break
              </button>
              <button className="ghost" onClick={() => setRecoveryReason(null)}>
                Continue Anyway
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {rankChange ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rank status update">
          <section className={`modal-card rank-change-card ${rankChange.direction === "up" ? "is-up" : "is-down"}`}>
            <header className="modal-head">
              <h2>{rankChange.direction === "up" ? "Rank Up Achieved" : "Rank Dropped"}</h2>
              <button className="ghost" onClick={() => setRankChange(null)}>
                Close
              </button>
            </header>
            {rankChange.direction === "up" ? (
              <p className="rank-change-copy">
                Strong momentum. You climbed from <strong>{rankChange.from}</strong> to <strong>{rankChange.to}</strong>.
              </p>
            ) : (
              <p className="rank-change-copy">
                Stay consistent this week. You moved from <strong>{rankChange.from}</strong> to <strong>{rankChange.to}</strong>.
              </p>
            )}
            <div className="control-row modal-actions">
              <button
                className="primary"
                onClick={() => {
                  setRankChange(null);
                  setRankModalOpen(true);
                }}
              >
                View Rank Ladder
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mobileProjectPickerOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pick project">
          <section className="mobile-sheet">
            <header className="modal-head">
              <h2>Select Project</h2>
              <button className="ghost" onClick={() => setMobileProjectPickerOpen(false)}>
                Close
              </button>
            </header>
            <div className="mobile-project-list">
              <button
                className={`project-badge ${projectId === "all" ? "is-active" : ""}`}
                onClick={async () => {
                  await changeProject("all");
                  setMobileProjectPickerOpen(false);
                }}
              >
                <span className="project-badge-dot" style={{ background: UNSELECTED_PROJECT_DOT }} />
                No Project
              </button>
              {projects.map((project) => (
                <button
                  key={`sheet-${project.id}`}
                  className={`project-badge ${projectId === project.id ? "is-active" : ""}`}
                  onClick={async () => {
                    await changeProject(project.id);
                    setMobileProjectPickerOpen(false);
                  }}
                >
                  <span className="project-badge-dot" style={{ background: projectDotColor(project) }} />
                  {project.name}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
