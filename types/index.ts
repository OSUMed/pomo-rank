export type Period = "day" | "week" | "month" | "year";

export type RankTier = {
  minMinutes: number;
  title: string;
  subtitle: string;
};

export type DailyPoint = {
  key: string;
  label: string;
  minutes: number;
};

export type DashboardSummary = {
  todayMinutes: number;
  rankTitle: string;
  rankSubtitle: string;
};
