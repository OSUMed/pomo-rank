# Pulse Pomodoro (Next.js + TypeScript + Supabase)

## Setup
1. Install dependencies:
   npm install
2. Copy `.env.example` to `.env.local` and fill values.
3. Run SQL in Supabase SQL Editor:
   `supabase/schema.sql`
4. Start app:
   npm run dev

## Auth
- Simple app-level auth with `username/password`.
- Session stored in `httpOnly` cookie.

## Features
- Pomodoro timer with focus/short break/long break modes
- Project/tag scoped tracking
- Manual daily log entry
- Stats by week/month/year
- Period-over-period delta comparisons (selected project and all projects)
- Greek mythology rank system with 6h/day max rank
