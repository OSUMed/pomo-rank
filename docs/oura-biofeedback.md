# Oura Biofeedback Definitions and Data Flow

This document explains exactly how the dashboard biofeedback values are defined, computed, and rendered.

## UI Terms and Definitions

### 1) `Current HR`
- Meaning: The most recent heart-rate sample in bpm from Oura.
- UI label: `Current HR: <value> bpm`
- Source field: `latestHeartRate` from `/api/oura/metrics`.

### 2) `Rolling 5-min avg`
- Meaning: Average bpm over the most recent 5-minute window, based on the latest available Oura samples.
- UI label: `Rolling 5-min avg: <value> bpm`
- Source field used for compute: `heartRateSamples` from `/api/oura/metrics`.

### 3) `Baseline`
- Meaning: Reference HR used to detect whether current effort is elevated.
- UI label: `Baseline: <value> bpm`
- Baseline priority:
1. Session baseline (`sessionBaselineBpm`) if available.
2. Learned profile baseline (`profile.baselineMedianBpm`) from historical telemetry.
3. If neither exists, shown as `--`.

### 4) `High windows`
- Meaning: Count of consecutive elevated rolling windows during an active focus run.
- UI label: `High windows: <count>`
- Note: This counter is only meaningful for active focus sessions. Outside focus mode, it is reset to `0`.

### 5) State labels
- `Focus steady`
  - Rolling HR is not above threshold.
- `Slow down`
  - Rolling HR is above threshold for at least one window.
- `Take a break`
  - During active focus: rolling HR stays elevated for at least two consecutive windows, and app can auto-pause timer.

## How Each Value Is Computed

## Rolling 5-min average
In `components/DashboardApp.tsx`:
- Find latest sample timestamp `t_latest`.
- Keep samples where `timestamp >= t_latest - 5 minutes`.
- Compute arithmetic mean of `bpm`.

Pseudo:
```ts
rolling5 = avg(samples.filter(s => s.ts >= latestTs - 5m).map(s => s.bpm))
```

## Effective baseline
In `components/DashboardApp.tsx`:
```ts
effectiveBaseline = sessionBaselineBpm ?? profile.baselineMedianBpm ?? rolling5
```
For display:
```ts
displayBaseline = sessionBaselineBpm ?? profile.baselineMedianBpm ?? null
```

## Threshold and state
In `components/DashboardApp.tsx`:
- `drift = profile.typicalDriftBpm ?? 8`
- `thresholdDelta = max(6, drift + 2)`
- `threshold = effectiveBaseline + thresholdDelta`
- `above = rolling5 > threshold`

Behavior:
- Not in focus mode:
  - state is `Slow down` if `above`, else `Focus steady`
  - no auto-pause, `High windows` reset.
- In active focus mode:
  - if first elevated window: state `Slow down`, high windows `1`
  - if >=2 consecutive elevated windows: state `Take a break`, timer can auto-pause.

## Session baseline learning
- Session baseline is estimated from first 5 minutes after focus start.
- Telemetry from focus sessions is saved via:
  - `POST /api/oura/focus-telemetry`
- Backend updates profile table with moving baseline and drift, used in future sessions.

## Endpoints Used

## A) Internal app endpoint used by UI
- `GET /api/oura/metrics`
- Optional params:
  - `focusStart` (ISO datetime)
  - `debug=1` (enable server debug logging)

Returns:
- `heartRateSamples[]`
- `latestHeartRate`
- `latestHeartRateTime`
- `stressToday`
- `profile`

## B) Oura endpoints called by backend (`lib/oura.ts`)
1. `GET https://api.ouraring.com/v2/usercollection/heartrate`
- Query params:
  - `start_datetime` (ISO-8601 UTC)
  - `end_datetime` (ISO-8601 UTC)
- Pagination handled with `next_token` until exhausted.
- Fetch strategy:
  1. primary window: last 24h (or older if focusStart-2h is earlier)
  2. fallback window: last 7 days if primary returns empty

2. `GET https://api.ouraring.com/v2/usercollection/daily_stress`
- Query params:
  - `start_date`
  - `end_date`

## C) Optional debug endpoint
- `GET /api/oura/debug`
- Returns stored/granted/missing scopes metadata (no token leakage).

## Sample API Response and UI Mapping

Example response from `/api/oura/metrics`:

```json
{
  "configured": true,
  "connected": true,
  "heartRateSamples": [
    { "timestamp": "2026-02-08T20:06:31.000Z", "bpm": 73 },
    { "timestamp": "2026-02-08T20:08:23.000Z", "bpm": 84 },
    { "timestamp": "2026-02-08T20:09:08.000Z", "bpm": 89 }
  ],
  "latestHeartRate": 89,
  "latestHeartRateTime": "2026-02-08T20:09:08.000Z",
  "stressToday": {
    "date": "2026-02-08",
    "stressedHours": 15,
    "engagedHours": 0,
    "relaxedHours": 0,
    "restoredHours": 0
  },
  "profile": {
    "baselineMedianBpm": null,
    "typicalDriftBpm": null,
    "sampleCount": 0
  },
  "warning": null
}
```

UI mapping from this example:
- `Current HR` = `latestHeartRate` => `89 bpm`
- `Last HR sample` = `latestHeartRateTime` => shown as local date-time
- `Rolling 5-min avg` = average over samples in latest 5 minutes
  - with above subset, approx `(73 + 84 + 89) / 3 = 82 bpm`
- `Baseline`
  - `sessionBaselineBpm` missing
  - `profile.baselineMedianBpm` is `null`
  - display `--`
- State:
  - still computed from rolling and fallback effective baseline logic
  - outside focus mode, state can show `Slow down` without auto-pause
- `Today so far` chips from `stressToday`:
  - `Stressed 15h`, `Engaged 0h`, `Relaxed 0h`, `Restored 0h`

## Notes on Delayed Data
- Oura heartrate can be delayed; not guaranteed to look real-time.
- UI message for empty HR:
  - `Waiting for Oura heart-rate samples (can be delayed). Press Start Focus, wear your ring, and sync Oura.`

