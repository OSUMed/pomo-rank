import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com";

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
    throw new Error(`Oura token exchange failed: ${res.status} ${text}`);
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
  const token = await fetchToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  await saveToken(userId, token);
  return token.access_token;
}

export async function revokeOuraConnection(userId: string) {
  const { error } = await supabase.from("oura_connections").delete().eq("user_id", userId);
  if (error) throw error;
}

async function getValidAccessToken(userId: string) {
  const conn = await getOuraConnection(userId);
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  const bufferMs = 90 * 1000;

  if (Number.isFinite(expiresAtMs) && expiresAtMs - bufferMs > Date.now()) {
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

function normalizeStressStateLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("restore")) return "Restored";
  if (normalized.includes("relax")) return "Relaxed";
  if (normalized.includes("engag")) return "Engaged";
  if (normalized.includes("stress")) return "Stressed";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function pickStressState(row: Record<string, unknown>) {
  const direct =
    row.stress_state ??
    row.state ??
    row.level ??
    row.status ??
    row.category ??
    row.resilience_level;

  if (typeof direct === "string") return normalizeStressStateLabel(direct);
  return null;
}

export async function getOuraMetrics(userId: string) {
  const token = await getValidAccessToken(userId);
  if (!token) {
    return {
      connected: false,
      heartRate: null as number | null,
      heartRateTime: null as string | null,
      stressState: null as string | null,
      stressDate: null as string | null,
    };
  }

  const end = new Date();
  const start = new Date(end.getTime() - 12 * 60 * 60 * 1000);

  const [heartRatePayload, stressPayload] = await Promise.all([
    fetchOuraCollection<Record<string, unknown>>(
      "/v2/usercollection/heartrate",
      token,
      new URLSearchParams({
        start_datetime: start.toISOString(),
        end_datetime: end.toISOString(),
      }),
    ),
    fetchOuraCollection<Record<string, unknown>>(
      "/v2/usercollection/daily_stress",
      token,
      new URLSearchParams({
        start_date: toIsoDate(new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000)),
        end_date: toIsoDate(end),
      }),
    ),
  ]);

  const heartRows = heartRatePayload.data ?? [];
  const latestHeart = heartRows[heartRows.length - 1] ?? null;

  const stressRows = stressPayload.data ?? [];
  const latestStress = stressRows[stressRows.length - 1] ?? null;

  return {
    connected: true,
    heartRate: latestHeart ? asNumber(latestHeart.bpm) : null,
    heartRateTime: latestHeart ? String(latestHeart.timestamp ?? "") || null : null,
    stressState: latestStress ? pickStressState(latestStress) : null,
    stressDate: latestStress ? String(latestStress.day ?? latestStress.date ?? "") || null : null,
  };
}
