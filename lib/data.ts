import { dayLabel, monthLabel, toDateKey } from "@/lib/date";
import { computeRank } from "@/lib/rank";
import { Period } from "@/types";
import { supabase } from "@/lib/supabase";

const ARCHIVE_PREFIX = "__archived__::";

function normalizeProjectName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

function normalizeProjectColor(color?: string | null) {
  if (!color) return null;
  const cleaned = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(cleaned)) return cleaned;
  return null;
}

function toMinutes(seconds: number) {
  return Math.floor(seconds / 60);
}

function hasMissingColumn(error: unknown, column: string) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message || "");
  return code === "42703" || message.includes(column);
}

function hasMissingArchivedColumn(error: unknown) {
  return hasMissingColumn(error, "archived");
}

function hasMissingColorColumn(error: unknown) {
  return hasMissingColumn(error, "color");
}

function isSupabaseConnectTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; details?: unknown };
  const message = String(record.message || "");
  const details = String(record.details || "");
  return (
    message.includes("fetch failed") ||
    details.includes("fetch failed") ||
    details.includes("UND_ERR_CONNECT_TIMEOUT") ||
    details.includes("Connect Timeout Error")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDateInput(dateValue?: string) {
  if (!dateValue) return new Date();
  const parsed = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function periodDays(period: Period) {
  if (period === "day") return 1;
  if (period === "month") return 30;
  if (period === "year") return 365;
  return 7;
}

function getRangeByPeriod(period: Period, anchorDate: Date) {
  const days = periodDays(period);
  const end = new Date(anchorDate);
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  return { start, end, days };
}

function shiftDateByDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function labelForPoint(date: Date, period: Period, index: number) {
  if (period === "year") {
    return date.getDate() === 1 ? monthLabel(date) : "";
  }

  if (period === "month") {
    return date.getDate() % 5 === 0 || index === 0 ? String(date.getDate()) : "";
  }

  if (period === "day") {
    return dayLabel(date);
  }

  return dayLabel(date);
}

export async function listProjects(userId: string, includeArchived = true) {
  let query = supabase
    .from("projects")
    .select("id, name, archived, color")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);

  const { data, error } = await query;

  if (!error) return data ?? [];
  if (!hasMissingArchivedColumn(error)) throw error;

  let fallbackQuery = supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (!includeArchived) fallbackQuery = fallbackQuery.limit(10000);

  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;

  const normalized = (fallbackData ?? []).map((project) => {
    const archived = project.name.startsWith(ARCHIVE_PREFIX);
    const name = archived ? project.name.replace(ARCHIVE_PREFIX, "") : project.name;
    return { ...project, archived, name, color: null };
  });

  return includeArchived ? normalized : normalized.filter((project) => !project.archived);
}

export async function createProject(userId: string, rawName: string, rawColor?: string | null) {
  const name = normalizeProjectName(rawName);
  if (!name) throw new Error("Project name is required");
  const color = normalizeProjectColor(rawColor);

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name, archived: false, color })
    .select("id, name, archived, color")
    .single();

  if (!error) return data;
  if (!hasMissingArchivedColumn(error) && !hasMissingColorColumn(error)) throw error;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("projects")
    .insert({ user_id: userId, name })
    .select("id, name")
    .single();

  if (fallbackError) throw fallbackError;
  return { ...fallbackData, archived: false, color: null };
}

export async function setProjectArchived(userId: string, projectId: string, archived: boolean) {
  const { data, error } = await supabase
    .from("projects")
    .update({ archived })
    .eq("user_id", userId)
    .eq("id", projectId)
    .select("id, name, archived, color")
    .single();

  if (!error) return data;
  if (!hasMissingArchivedColumn(error)) throw error;

  const { data: existingProject, error: existingError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", userId)
    .eq("id", projectId)
    .single();
  if (existingError) throw existingError;

  const currentName = String(existingProject.name);
  const normalizedName = currentName.startsWith(ARCHIVE_PREFIX)
    ? currentName.replace(ARCHIVE_PREFIX, "")
    : currentName;
  const nextName = archived ? `${ARCHIVE_PREFIX}${normalizedName}` : normalizedName;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("projects")
    .update({ name: nextName })
    .eq("user_id", userId)
    .eq("id", projectId)
    .select("id, name")
    .single();

  if (fallbackError) throw fallbackError;
  return { ...fallbackData, archived, name: normalizedName };
}

export async function setProjectColor(userId: string, projectId: string, rawColor: string) {
  const color = normalizeProjectColor(rawColor);
  if (!color) throw new Error("Invalid color format");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await supabase
      .from("projects")
      .update({ color })
      .eq("user_id", userId)
      .eq("id", projectId)
      .select("id, name, archived, color")
      .single();

    if (!error) return data;
    if (hasMissingColorColumn(error)) {
      throw new Error("Project color is not available yet. Please run latest schema migration.");
    }

    lastError = error;
    if (!isSupabaseConnectTimeout(error) || attempt === 3) break;
    await sleep(attempt * 250);
  }
  throw lastError;
}

export async function getProjectTotals(userId: string) {
  const [projects, logsResult] = await Promise.all([
    listProjects(userId, true),
    supabase.from("focus_logs").select("project_id, seconds").eq("user_id", userId),
  ]);

  const { data: logs, error } = logsResult;
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const log of logs ?? []) {
    if (!log.project_id) continue;
    totals.set(log.project_id, (totals.get(log.project_id) ?? 0) + log.seconds);
  }

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    archived: Boolean(project.archived),
    color: project.color || null,
    totalSeconds: totals.get(project.id) ?? 0,
  }));
}

export async function ensureProjectBelongsToUser(userId: string, projectId: string | null) {
  if (!projectId) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Invalid project");
  return data.id;
}

export async function addLog(params: {
  userId: string;
  projectId: string | null;
  date: string;
  seconds: number;
  source: "timer" | "manual";
}) {
  const { userId, projectId, date, seconds, source } = params;
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (!safeSeconds) return;

  const ownedProjectId = await ensureProjectBelongsToUser(userId, projectId);

  const { error } = await supabase.from("focus_logs").insert({
    user_id: userId,
    project_id: ownedProjectId,
    log_date: date,
    seconds: safeSeconds,
    source,
  });

  if (error) throw error;
}

export type RecentLogEntry = {
  id: string;
  projectId: string | null;
  projectName: string;
  logDate: string;
  seconds: number;
  source: "timer" | "manual";
  createdAt: string;
};

export async function getRecentLogs(userId: string, opts?: { limit?: number; date?: string }) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(Number(opts?.limit ?? 30))));

  let query = supabase
    .from("focus_logs")
    .select("id, project_id, log_date, seconds, source, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (opts?.date) {
    query = query.eq("log_date", opts.date);
  }

  const { data, error } = await query;
  if (error) throw error;

  const projects = await listProjects(userId, true);
  const projectMap = new Map<string, string>();
  for (const project of projects) projectMap.set(project.id, project.name);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    projectId: row.project_id ?? null,
    projectName: row.project_id ? projectMap.get(row.project_id) || "Unknown project" : "No project",
    logDate: String(row.log_date),
    seconds: Number(row.seconds) || 0,
    source: row.source === "manual" ? "manual" : "timer",
    createdAt: String(row.created_at),
  })) as RecentLogEntry[];
}

export async function deleteRecentLog(userId: string, logId: string) {
  const { data: recentRows, error: recentError } = await supabase
    .from("focus_logs")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (recentError) throw recentError;

  const allowed = new Set((recentRows ?? []).map((row) => String(row.id)));
  if (!allowed.has(logId)) {
    throw new Error("You can only delete entries from your most recent 30 logs.");
  }

  const { error } = await supabase.from("focus_logs").delete().eq("user_id", userId).eq("id", logId);
  if (error) throw error;
}

export async function getTodaySummary(userId: string, projectId: string | "all") {
  const todayRange = getRangeByPeriod("day", new Date());
  const weekRange = getRangeByPeriod("week", new Date());

  const todaySummary = await getRangeSummary(userId, projectId, todayRange.start, todayRange.end, "day");
  const weekSummary = await getRangeSummary(userId, projectId, weekRange.start, weekRange.end, "week");

  const sevenDayAverageMinutes = Math.floor(toMinutes(weekSummary.totalSeconds) / 7);
  const rank = computeRank(sevenDayAverageMinutes);

  return {
    todayMinutes: toMinutes(todaySummary.totalSeconds),
    sevenDayTotalMinutes: toMinutes(weekSummary.totalSeconds),
    sevenDayAverageMinutes,
    rankTitle: rank.title,
    rankSubtitle: rank.subtitle,
  };
}

export async function getStats(
  userId: string,
  projectId: string | "all",
  period: Period,
  anchorDateInput?: string,
) {
  const anchorDate = parseDateInput(anchorDateInput);
  const current = getRangeByPeriod(period, anchorDate);
  const previousEnd = shiftDateByDays(current.start, -1);
  const previous = getRangeByPeriod(period, previousEnd);

  const [currentSummary, previousSummary, rankSummary, projectTotals, allCurrentSummary, allPreviousSummary] =
    await Promise.all([
      getRangeSummary(userId, projectId, current.start, current.end, period),
      getRangeSummary(userId, projectId, previous.start, previous.end, period),
      getRangeSummary(userId, projectId, shiftDateByDays(anchorDate, -6), anchorDate, "week"),
      getProjectBreakdown(userId, projectId, current.start, current.end),
      getRangeSummary(userId, "all", current.start, current.end, period),
      getRangeSummary(userId, "all", previous.start, previous.end, period),
    ]);

  const rank = computeRank(Math.floor(toMinutes(rankSummary.totalSeconds) / 7));

  const selectedComparison = buildComparison(currentSummary.totalSeconds, previousSummary.totalSeconds);
  const allComparison = buildComparison(allCurrentSummary.totalSeconds, allPreviousSummary.totalSeconds);

  const totalMinutes = toMinutes(currentSummary.totalSeconds);
  const projectBreakdown = projectTotals.map((item) => {
    const minutes = toMinutes(item.seconds);
    const percent = totalMinutes ? Math.round((minutes / totalMinutes) * 100) : 0;
    return {
      projectId: item.projectId,
      name: item.name,
      minutes,
      percent,
    };
  });

  return {
    anchorDate: toDateKey(anchorDate),
    period,
    range: {
      startDate: toDateKey(current.start),
      endDate: toDateKey(current.end),
      dayCount: current.days,
    },
    totalMinutes,
    averageMinutes: Math.floor(totalMinutes / current.days),
    rank,
    chartPoints: currentSummary.points.map((point) => ({
      key: point.key,
      label: point.label,
      minutes: toMinutes(point.seconds),
    })),
    projectBreakdown,
    selectedComparison,
    allComparison,
  };
}

function buildComparison(currentSeconds: number, previousSeconds: number) {
  const currentMinutes = toMinutes(currentSeconds);
  const previousMinutes = toMinutes(previousSeconds);
  const deltaMinutes = currentMinutes - previousMinutes;

  let percentChange: number | null = null;
  if (previousMinutes === 0) {
    percentChange = currentMinutes > 0 ? 100 : 0;
  } else {
    percentChange = Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100);
  }

  return {
    currentMinutes,
    previousMinutes,
    deltaMinutes,
    percentChange,
  };
}

async function getRangeSummary(
  userId: string,
  projectId: string | "all",
  startDate: Date,
  endDate: Date,
  period: Period,
) {
  let query = supabase
    .from("focus_logs")
    .select("log_date, seconds")
    .eq("user_id", userId)
    .gte("log_date", toDateKey(startDate))
    .lte("log_date", toDateKey(endDate));

  if (projectId !== "all") query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.log_date;
    map.set(key, (map.get(key) ?? 0) + row.seconds);
  }

  const points: { key: string; label: string; seconds: number }[] = [];
  let totalSeconds = 0;

  const cursor = new Date(startDate);
  let idx = 0;
  while (cursor <= endDate) {
    const key = toDateKey(cursor);
    const seconds = map.get(key) ?? 0;
    totalSeconds += seconds;

    points.push({
      key,
      label: labelForPoint(cursor, period, idx),
      seconds,
    });

    cursor.setDate(cursor.getDate() + 1);
    idx += 1;
  }

  return { points, totalSeconds };
}

async function getProjectBreakdown(
  userId: string,
  projectId: string | "all",
  startDate: Date,
  endDate: Date,
) {
  const [projects, logsResult] = await Promise.all([
    listProjects(userId),
    (() => {
      let query = supabase
        .from("focus_logs")
        .select("project_id, seconds")
        .eq("user_id", userId)
        .gte("log_date", toDateKey(startDate))
        .lte("log_date", toDateKey(endDate));

      if (projectId !== "all") query = query.eq("project_id", projectId);
      return query;
    })(),
  ]);

  const { data: logs, error } = logsResult;
  if (error) throw error;

  const projectMap = new Map<string, string>();
  for (const project of projects) projectMap.set(project.id, project.name);

  const totals = new Map<string, { projectId: string; name: string; seconds: number }>();

  for (const log of logs ?? []) {
    const id = log.project_id || "none";
    const name = log.project_id ? projectMap.get(log.project_id) || "Unknown" : "No project";

    const existing = totals.get(id);
    if (existing) existing.seconds += log.seconds;
    else totals.set(id, { projectId: id, name, seconds: log.seconds });
  }

  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}
