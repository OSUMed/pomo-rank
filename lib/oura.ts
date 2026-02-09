import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com";
const TOKEN_EXPIRY_BUFFER_MS = 90 * 1000;
const MAX_HEARTRATE_WINDOW_MS = 60 * 60 * 1000;
const refreshLocks = new Map<string, Promise<string>>();

type OuraConnectionRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_type: string | null;
  scope: string | null;
  expires_at: string;
};

type OuraTokenResponse = {
  access_token: string;
  token_type?: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

type OuraFocusProfileRow = {
  user_id: string;
  baseline_median_bpm: number;
  typical_drift_bpm: number;
  sample_count: number;
  updated_at: string;
};

export type OuraFocusProfile = {
  baselineMedianBpm: number | null;
  typicalDriftBpm: number | null;
  sampleCount: number;
};

export type OuraHeartRateSample = {
  timestamp: string;
  bpm: number;
};

export type OuraStressBuckets = {
  date: string | null;
  stressedHours: number;
  engagedHours: number;
  relaxedHours: number;
  restoredHours: number;
};

export type OuraBiofeedback = {
  connected: boolean;
  heartRateSamples: OuraHeartRateSample[];
  latestHeartRate: number | null;
  latestHeartRateTime: string | null;
  stressToday: OuraStressBuckets | null;
  profile: OuraFocusProfile;
  warning: string | null;
};

export type FocusTelemetryInput = {
  sessionStartedAt: string;
  sessionEndedAt: string;
  baselineBpm: number;
  peakRollingBpm: number;
  avgRollingBpm: number;
  alertWindows: number;
};

function requireOuraConfig() {
  if (!env.ouraClientId || !env.ouraClientSecret || !env.ouraRedirectUri) {
    throw new Error("Missing Oura OAuth configuration");
  }

  return {
    clientId: env.ouraClientId,
    clientSecret: env.ouraClientSecret,
    redirectUri: env.ouraRedirectUri,
  };
}

export function isOuraConfigured() {
  return Boolean(env.ouraClientId && env.ouraClientSecret && env.ouraRedirectUri);
}

export function getOuraAuthorizeUrl(state: string) {
  const { clientId, redirectUri } = requireOuraConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "daily heartrate",
    state,
  });

  return `${OURA_AUTH_URL}?${params.toString()}`;
}

export async function getOuraConnection(userId: string) {
  const { data, error } = await supabase
    .from("oura_connections")
    .select("user_id, access_token, refresh_token, token_type, scope, expires_at")
    .eq("user_id", userId)
    .maybeSingle<OuraConnectionRow>();

  if (error) throw error;
  return data;
}

async function saveToken(userId: string, token: OuraTokenResponse) {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  const { error } = await supabase.from("oura_connections").upsert(
    {
      user_id: userId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type ?? "Bearer",
      scope: token.scope ?? null,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

async function fetchToken(params: Record<string, string>) {
  const { clientId, clientSecret } = requireOuraConfig();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...params,
  });

  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string; title?: string; error?: string; error_description?: string };
      detail = parsed.detail || parsed.error_description || parsed.title || parsed.error || text;
    } catch {
      // keep raw text
    }
    throw new Error(`Oura token exchange failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as OuraTokenResponse;
}

export async function exchangeCodeForToken(userId: string, code: string) {
  const { redirectUri } = requireOuraConfig();

  const token = await fetchToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  await saveToken(userId, token);
}

async function refreshAccessToken(userId: string, refreshToken: string) {
  const existing = refreshLocks.get(userId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const token = await fetchToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      await saveToken(userId, token);
      return token.access_token;
    } catch (error) {
      const message = String(error);
      if (message.includes("invalid_grant")) {
        const latest = await getOuraConnection(userId);
        if (latest) {
          const latestExpiry = new Date(latest.expires_at).getTime();
          if (Number.isFinite(latestExpiry) && latestExpiry - TOKEN_EXPIRY_BUFFER_MS > Date.now()) {
            return latest.access_token;
          }
        }
      }
      throw error;
    } finally {
      refreshLocks.delete(userId);
    }
  })();

  refreshLocks.set(userId, refreshPromise);
  return refreshPromise;
}

export async function revokeOuraConnection(userId: string) {
  const { error } = await supabase.from("oura_connections").delete().eq("user_id", userId);
  if (error) throw error;
}

async function getValidAccessToken(userId: string) {
  const conn = await getOuraConnection(userId);
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return conn.access_token;
  }

  if (expiresAtMs - TOKEN_EXPIRY_BUFFER_MS > Date.now()) {
    return conn.access_token;
  }

  return refreshAccessToken(userId, conn.refresh_token);
}

async function fetchOuraCollection<T>(path: string, token: string, params: URLSearchParams) {
  const res = await fetch(`${OURA_API_BASE}${path}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oura collection request failed for ${path}: ${res.status} ${text}`);
  }

  return (await res.json()) as { data?: T[] };
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toHours(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 10) / 10;
}

function defaultProfile(): OuraFocusProfile {
  return {
    baselineMedianBpm: null,
    typicalDriftBpm: null,
    sampleCount: 0,
  };
}

function hasMissingTable(error: unknown, tableName: string) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message || "");
  return code === "42P01" || message.includes(tableName);
}

async function getFocusProfile(userId: string): Promise<OuraFocusProfile> {
  const { data, error } = await supabase
    .from("oura_focus_profiles")
    .select("user_id, baseline_median_bpm, typical_drift_bpm, sample_count, updated_at")
    .eq("user_id", userId)
    .maybeSingle<OuraFocusProfileRow>();

  if (error) {
    if (hasMissingTable(error, "oura_focus_profiles")) return defaultProfile();
    throw error;
  }

  if (!data) return defaultProfile();

  return {
    baselineMedianBpm: Number(data.baseline_median_bpm) || null,
    typicalDriftBpm: Number(data.typical_drift_bpm) || null,
    sampleCount: Number(data.sample_count) || 0,
  };
}

function normalizeStressStateLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("restore")) return "Restored";
  if (normalized.includes("relax")) return "Relaxed";
  if (normalized.includes("engag")) return "Engaged";
  if (normalized.includes("stress")) return "Stressed";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function summarizeStressToday(row: Record<string, unknown> | null): OuraStressBuckets | null {
  if (!row) return null;

  const restoredMinutes = asNumber(row.restorative_minutes) ?? asNumber(row.recovery_minutes) ?? 0;
  const relaxedMinutes = asNumber(row.low_stress_minutes) ?? asNumber(row.stress_low) ?? 0;
  const engagedMinutes = asNumber(row.medium_stress_minutes) ?? asNumber(row.stress_medium) ?? 0;
  const stressedMinutes = asNumber(row.high_stress_minutes) ?? asNumber(row.stress_high) ?? 0;

  const directState =
    (typeof row.stress_state === "string" ? normalizeStressStateLabel(row.stress_state) : null) ||
    (typeof row.state === "string" ? normalizeStressStateLabel(row.state) : null);

  if (directState) {
    if (directState === "Stressed" && stressedMinutes === 0) {
      return {
        date: String(row.day ?? row.date ?? "") || null,
        stressedHours: 0.1,
        engagedHours: toHours(engagedMinutes),
        relaxedHours: toHours(relaxedMinutes),
        restoredHours: toHours(restoredMinutes),
      };
    }
  }

  return {
    date: String(row.day ?? row.date ?? "") || null,
    stressedHours: toHours(stressedMinutes),
    engagedHours: toHours(engagedMinutes),
    relaxedHours: toHours(relaxedMinutes),
    restoredHours: toHours(restoredMinutes),
  };
}

function parseFocusStart(input: string | null | undefined) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function getOuraBiofeedback(userId: string, focusStartInput?: string | null): Promise<OuraBiofeedback> {
  let token: string | null = null;
  try {
    token = await getValidAccessToken(userId);
  } catch (error) {
    console.error("Oura token lookup/refresh failed", error);
    try {
      await revokeOuraConnection(userId);
    } catch (cleanupError) {
      console.error("Failed to cleanup invalid Oura connection", cleanupError);
    }
    return {
      connected: false,
      heartRateSamples: [],
      latestHeartRate: null,
      latestHeartRateTime: null,
      stressToday: null,
      profile: defaultProfile(),
      warning: "Token refresh failed. Please reconnect Oura.",
    };
  }

  if (!token) {
    return {
      connected: false,
      heartRateSamples: [],
      latestHeartRate: null,
      latestHeartRateTime: null,
      stressToday: null,
      profile: defaultProfile(),
      warning: null,
    };
  }

  const now = new Date();
  const parsedFocusStart = parseFocusStart(focusStartInput);
  const requestedStart = parsedFocusStart ?? new Date(now.getTime() - 30 * 60 * 1000);
  const start = new Date(Math.max(requestedStart.getTime(), now.getTime() - MAX_HEARTRATE_WINDOW_MS));

  const [profile, heartRateResult, stressResult] = await Promise.all([
    getFocusProfile(userId),
    fetchOuraCollection<Record<string, unknown>>(
      "/v2/usercollection/heartrate",
      token,
      new URLSearchParams({
        start_datetime: start.toISOString(),
        end_datetime: now.toISOString(),
      }),
    ).catch((error) => {
      console.error("Oura heartrate fetch failed", error);
      return { data: [] as Record<string, unknown>[] };
    }),
    fetchOuraCollection<Record<string, unknown>>(
      "/v2/usercollection/daily_stress",
      token,
      new URLSearchParams({
        start_date: toIsoDate(now),
        end_date: toIsoDate(now),
      }),
    ).catch((error) => {
      console.error("Oura daily_stress fetch failed", error);
      return { data: [] as Record<string, unknown>[] };
    }),
  ]);

  const samples = (heartRateResult.data ?? [])
    .map((row) => {
      const bpm = asNumber(row.bpm);
      const timestamp = String(row.timestamp ?? "");
      if (!bpm || !timestamp) return null;
      return { timestamp, bpm };
    })
    .filter((row): row is OuraHeartRateSample => Boolean(row))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const latest = samples[samples.length - 1] ?? null;
  const stressRow = (stressResult.data ?? [])[0] ?? null;

  return {
    connected: true,
    heartRateSamples: samples,
    latestHeartRate: latest?.bpm ?? null,
    latestHeartRateTime: latest?.timestamp ?? null,
    stressToday: summarizeStressToday(stressRow),
    profile,
    warning: null,
  };
}

export async function saveFocusTelemetry(userId: string, input: FocusTelemetryInput) {
  const baseline = Math.max(30, Math.min(220, Number(input.baselineBpm) || 0));
  const peak = Math.max(30, Math.min(220, Number(input.peakRollingBpm) || 0));
  const average = Math.max(30, Math.min(220, Number(input.avgRollingBpm) || 0));
  const alerts = Math.max(0, Math.floor(Number(input.alertWindows) || 0));

  if (!baseline || !peak || !average) {
    throw new Error("Invalid focus telemetry payload");
  }

  const startedAt = new Date(input.sessionStartedAt);
  const endedAt = new Date(input.sessionEndedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new Error("Invalid session timestamps");
  }

  const { error: telemetryError } = await supabase.from("oura_focus_telemetry").insert({
    user_id: userId,
    session_started_at: startedAt.toISOString(),
    session_ended_at: endedAt.toISOString(),
    baseline_bpm: baseline,
    peak_rolling_bpm: peak,
    avg_rolling_bpm: average,
    alert_windows: alerts,
  });

  if (telemetryError && !hasMissingTable(telemetryError, "oura_focus_telemetry")) {
    throw telemetryError;
  }

  const existing = await getFocusProfile(userId);
  const sessionDrift = Math.max(0, peak - baseline);

  const existingBaseline = existing.baselineMedianBpm ?? baseline;
  const existingDrift = existing.typicalDriftBpm ?? Math.max(6, sessionDrift);
  const weight = existing.sampleCount > 0 ? 0.2 : 1;

  const nextBaseline = Math.round((existingBaseline * (1 - weight) + baseline * weight) * 10) / 10;
  const nextDrift = Math.round((existingDrift * (1 - weight) + sessionDrift * weight) * 10) / 10;

  const { error: profileError } = await supabase.from("oura_focus_profiles").upsert(
    {
      user_id: userId,
      baseline_median_bpm: nextBaseline,
      typical_drift_bpm: Math.max(4, nextDrift),
      sample_count: existing.sampleCount + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (profileError && !hasMissingTable(profileError, "oura_focus_profiles")) {
    throw profileError;
  }

  return {
    baselineMedianBpm: nextBaseline,
    typicalDriftBpm: Math.max(4, nextDrift),
    sampleCount: existing.sampleCount + 1,
  };
}
