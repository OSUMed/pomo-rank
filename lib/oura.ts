import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com";
const TOKEN_EXPIRY_BUFFER_MS = 90 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOCUS_PADDING_MS = 2 * 60 * 60 * 1000;
const MAX_PAGES = 25;
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

type OuraCollectionResponse<T> = {
  data?: T[];
  next_token?: string | null;
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

export type OuraScopeDebug = {
  connected: boolean;
  storedScope: string | null;
  grantedScopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  expiresAt: string | null;
  tokenType: string | null;
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

function isOuraDebugEnabled(explicit?: boolean) {
  if (explicit) return true;
  const raw = (process.env.OURA_DEBUG_LOGS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
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

export async function getOuraScopeDebug(userId: string): Promise<OuraScopeDebug> {
  const conn = await getOuraConnection(userId);
  if (!conn) {
    return {
      connected: false,
      storedScope: null,
      grantedScopes: [],
      requiredScopes: ["heartrate", "daily"],
      missingScopes: ["heartrate", "daily"],
      expiresAt: null,
      tokenType: null,
    };
  }

  const grantedScopes = (conn.scope || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const requiredScopes = ["heartrate", "daily"];
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));

  return {
    connected: true,
    storedScope: conn.scope,
    grantedScopes,
    requiredScopes,
    missingScopes,
    expiresAt: conn.expires_at || null,
    tokenType: conn.token_type || null,
  };
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

async function fetchOuraCollectionPaginated<T>(
  path: string,
  token: string,
  params: URLSearchParams,
  options?: { debug?: boolean; label?: string },
) {
  const all: T[] = [];
  let nextToken: string | null = null;
  let page = 0;
  const debug = isOuraDebugEnabled(options?.debug);
  const label = options?.label || path;

  do {
    page += 1;
    const pageParams = new URLSearchParams(params.toString());
    if (nextToken) pageParams.set("next_token", nextToken);
    const url = `${OURA_API_BASE}${path}?${pageParams.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (debug) {
      console.info("[OURA_DEBUG] request", { label, url, page });
      console.info("[OURA_DEBUG] response", { label, status: res.status });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Oura collection request failed for ${path}: ${res.status} ${text}`);
    }

    const payload = (await res.json()) as OuraCollectionResponse<T>;
    const chunk = payload.data ?? [];
    all.push(...chunk);
    nextToken = payload.next_token || null;

    if (debug) {
      console.info("[OURA_DEBUG] page_data", {
        label,
        page,
        documents: chunk.length,
        total: all.length,
        nextTokenPresent: Boolean(nextToken),
      });
    }
  } while (nextToken && page < MAX_PAGES);

  return { data: all };
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

function extractTimestamp(row: Record<string, unknown>) {
  const candidate =
    (typeof row.timestamp === "string" && row.timestamp) ||
    (typeof row.datetime === "string" && row.datetime) ||
    (typeof row.ts === "string" && row.ts) ||
    "";
  return candidate || null;
}

function extractBpm(row: Record<string, unknown>) {
  return asNumber(row.bpm) ?? asNumber(row.heart_rate) ?? asNumber(row.hr);
}

function minMaxTimestamp(samples: OuraHeartRateSample[]) {
  if (!samples.length) return { min: null, max: null };
  return {
    min: samples[0].timestamp,
    max: samples[samples.length - 1].timestamp,
  };
}

function toHours(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 10) / 10;
}

function toHoursFromSeconds(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return 0;
  return Math.round((seconds / 3600) * 10) / 10;
}

function normalizeDurationToHours(raw: number | null, unitHint?: "minutes" | "seconds" | "hours") {
  if (!raw || raw <= 0) return 0;
  if (unitHint === "minutes") return toHours(raw);
  if (unitHint === "seconds") return toHoursFromSeconds(raw);
  if (unitHint === "hours") return Math.round(raw * 10) / 10;

  // Fallback heuristic for unknown keys:
  //  - >= 3600 likely seconds
  //  - > 24 likely minutes
  //  - <= 24 likely hours
  if (raw >= 3600) return toHoursFromSeconds(raw);
  if (raw > 24) return toHours(raw);
  return Math.round(raw * 10) / 10;
}

function pickDurationHours(
  row: Record<string, unknown>,
  keys: { minutes?: string[]; seconds?: string[]; hours?: string[]; fallback?: string[] },
) {
  for (const key of keys.minutes ?? []) {
    const value = asNumber(row[key]);
    if (value !== null) return normalizeDurationToHours(value, "minutes");
  }
  for (const key of keys.seconds ?? []) {
    const value = asNumber(row[key]);
    if (value !== null) return normalizeDurationToHours(value, "seconds");
  }
  for (const key of keys.hours ?? []) {
    const value = asNumber(row[key]);
    if (value !== null) return normalizeDurationToHours(value, "hours");
  }
  for (const key of keys.fallback ?? []) {
    const value = asNumber(row[key]);
    if (value !== null) return normalizeDurationToHours(value);
  }
  return 0;
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

  const restoredHours = pickDurationHours(row, {
    minutes: ["restorative_minutes", "recovery_minutes", "restored_minutes"],
    seconds: ["restorative_seconds", "recovery_seconds", "restored_seconds"],
    hours: ["restorative_hours", "recovery_hours", "restored_hours"],
    fallback: ["restorative", "recovery", "restored"],
  });
  const relaxedHours = pickDurationHours(row, {
    minutes: ["low_stress_minutes", "relaxed_minutes", "stress_low"],
    seconds: ["low_stress_seconds", "relaxed_seconds"],
    hours: ["low_stress_hours", "relaxed_hours"],
    fallback: ["relaxed"],
  });
  const engagedHours = pickDurationHours(row, {
    minutes: ["medium_stress_minutes", "engaged_minutes", "stress_medium"],
    seconds: ["medium_stress_seconds", "engaged_seconds"],
    hours: ["medium_stress_hours", "engaged_hours"],
    fallback: ["engaged"],
  });
  const stressedHours = pickDurationHours(row, {
    minutes: ["high_stress_minutes", "stressed_minutes", "stress_high"],
    seconds: ["high_stress_seconds", "stressed_seconds"],
    hours: ["high_stress_hours", "stressed_hours"],
    fallback: ["stressed"],
  });

  const directState =
    (typeof row.stress_state === "string" ? normalizeStressStateLabel(row.stress_state) : null) ||
    (typeof row.state === "string" ? normalizeStressStateLabel(row.state) : null);

  if (directState) {
    if (directState === "Stressed" && stressedHours === 0) {
      return {
        date: String(row.day ?? row.date ?? "") || null,
        stressedHours: 0.1,
        engagedHours,
        relaxedHours,
        restoredHours,
      };
    }
  }

  return {
    date: String(row.day ?? row.date ?? "") || null,
    stressedHours,
    engagedHours,
    relaxedHours,
    restoredHours,
  };
}

function parseFocusStart(input: string | null | undefined) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function fetchHeartRateWithFallback(
  token: string,
  focusStart: Date | null,
  debug?: boolean,
) {
  const now = new Date();
  const start24 = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);
  const focusBufferedStart = focusStart ? new Date(focusStart.getTime() - FOCUS_PADDING_MS) : null;
  const primaryStart = focusBufferedStart && focusBufferedStart < start24 ? focusBufferedStart : start24;

  const primaryParams = new URLSearchParams({
    start_datetime: primaryStart.toISOString(),
    end_datetime: now.toISOString(),
  });

  if (isOuraDebugEnabled(debug)) {
    console.info("[OURA_DEBUG] heartrate_window_primary", {
      start_datetime: primaryParams.get("start_datetime"),
      end_datetime: primaryParams.get("end_datetime"),
      focusStart: focusStart?.toISOString() ?? null,
    });
  }

  const primary = await fetchOuraCollectionPaginated<Record<string, unknown>>(
    "/v2/usercollection/heartrate",
    token,
    primaryParams,
    { debug, label: "heartrate_primary" },
  );

  if ((primary.data?.length ?? 0) > 0) return primary;

  const fallbackStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const fallbackParams = new URLSearchParams({
    start_datetime: fallbackStart.toISOString(),
    end_datetime: now.toISOString(),
  });

  if (isOuraDebugEnabled(debug)) {
    console.info("[OURA_DEBUG] heartrate_window_fallback", {
      start_datetime: fallbackParams.get("start_datetime"),
      end_datetime: fallbackParams.get("end_datetime"),
    });
  }

  return fetchOuraCollectionPaginated<Record<string, unknown>>(
    "/v2/usercollection/heartrate",
    token,
    fallbackParams,
    { debug, label: "heartrate_fallback" },
  );
}

export async function getOuraBiofeedback(
  userId: string,
  focusStartInput?: string | null,
  options?: { debug?: boolean },
): Promise<OuraBiofeedback> {
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

  const parsedFocusStart = parseFocusStart(focusStartInput);
  const now = new Date();
  const debug = options?.debug;

  const [profile, heartRateResult, stressResult] = await Promise.all([
    getFocusProfile(userId),
    fetchHeartRateWithFallback(token, parsedFocusStart, debug).catch((error) => {
      console.error("Oura heartrate fetch failed", error);
      return { data: [] as Record<string, unknown>[] };
    }),
    fetchOuraCollectionPaginated<Record<string, unknown>>(
      "/v2/usercollection/daily_stress",
      token,
      new URLSearchParams({
        start_date: toIsoDate(now),
        end_date: toIsoDate(now),
      }),
      { debug, label: "daily_stress" },
    ).catch((error) => {
      console.error("Oura daily_stress fetch failed", error);
      return { data: [] as Record<string, unknown>[] };
    }),
  ]);

  const samples = (heartRateResult.data ?? [])
    .map((row) => {
      const bpm = extractBpm(row);
      const timestamp = extractTimestamp(row);
      if (!bpm || !timestamp) return null;
      return { timestamp, bpm };
    })
    .filter((row): row is OuraHeartRateSample => Boolean(row))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (isOuraDebugEnabled(debug)) {
    const span = minMaxTimestamp(samples);
    console.info("[OURA_DEBUG] heartrate_summary", {
      documents: (heartRateResult.data ?? []).length,
      mappedSamples: samples.length,
      minTimestamp: span.min,
      maxTimestamp: span.max,
    });
  }

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
