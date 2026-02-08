import { RankTier } from "@/types";

export const MAX_DAILY_MINUTES_FOR_MAX_RANK = 360;

export const RANK_TIERS: RankTier[] = [
  { minMinutes: 0, title: "Mortal", subtitle: "The journey begins." },
  { minMinutes: 30, title: "Scout of Hermes", subtitle: "Quick, consistent starts." },
  { minMinutes: 60, title: "Scholar of Athena", subtitle: "Solid daily discipline." },
  { minMinutes: 120, title: "Hoplite of Ares", subtitle: "Battle-tested focus." },
  { minMinutes: 180, title: "Strategos", subtitle: "Strong command of your time." },
  { minMinutes: 240, title: "Oracle of Delphi", subtitle: "Elite consistency and clarity." },
  { minMinutes: 300, title: "Hero of Olympus", subtitle: "Near mythic work ethic." },
  { minMinutes: 330, title: "Demigod", subtitle: "Exceptional 7-day output." },
  { minMinutes: 360, title: "Zeus", subtitle: "Maximum rank: 6h/day average." },
];

export function computeRank(averageDailyMinutes: number) {
  let active = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (averageDailyMinutes >= tier.minMinutes) active = tier;
  }
  return active;
}
