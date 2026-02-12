# Project Periselene - SFS Competition Control App

Project Periselene is a real-time web app for running a **Spaceflight Simulator (SFS) rocket competition**.

It provides role-based dashboards for:
- **Admin**: runs the event clock, phase transitions, and live stream monitor.
- **Participant (Pilot)**: shares screen, uploads blueprint, tracks timer, and records landing.
- **Judge**: watches teams, enters scoring inputs, and ranks teams by final score.

## What This App Is Meant To Do

This app coordinates a full competition round from lobby to final judging:
1. Pilots join from the login page.
2. Admin starts **Build** phase (global countdown + timer sync).
3. Pilots upload blueprint image + SFS link.
4. Admin starts **Flight** phase (global start time for all teams).
5. Pilots stream gameplay using PeerJS and mark landing with slide-to-confirm.
6. Judge scores budget, mission bonuses, landing grade, penalties, and notes.
7. Admin can reset for next heat.

## Role-Based Pages

### Login (`/`)
- Role switch: `PILOT`, `JUDGE`, `ADMIN`
- Participant login creates a row in `participants`
- Passcodes for judges and admins

### Admin (`/admin`)
- Live participant list + stream spotlight
- Global controls:
  - `START BUILD`
  - `START FLIGHT`
  - `STOP`
  - `RESET`
  - `SHOW TIMER`
- Countdown broadcast to all participants
- Big mission timer + timeline + telemetry style HUD

### Participant (`/participant`)
- Team/pilot timer synced from global state
- Screen sharing with PeerJS
- Build-phase blueprint upload:
  - image -> Supabase Storage bucket `blueprint`
  - blueprint link -> `participants.blueprint_link`
- Flight landing registration:
  - updates `status`, `land_time`, `flight_duration` immediately
  - captures current shared frame and stores URL in `participants.landing_frame_url` (if stream is active)
- Rulebook quick link + timer overlay button (PiP)

### Judge (`/judge`)
- Scrollable roster of all participants
- Real-time flight time visibility
- Budget scoring and auto score effects
- Landing grade, penalties, notes
- Rank sorting by computed final score
- Blueprint preview + link copy

## Tech Stack

- `React` + `Vite`
- `react-router-dom` for routing
- `@supabase/supabase-js` for DB + storage
- `PeerJS` for stream relay
- `lucide-react` icons

## Data Model Used By App

### `participants` table
The app expects these columns (core + judging + blueprint):
- `id` (uuid, pk)
- `team_name` (text)
- `peer_id` (text)
- `status` (text)
- `start_time` (timestamptz)
- `land_time` (timestamptz)
- `flight_duration` (int)
- `created_at` (timestamptz)
- `used_budget` (int / numeric)
- `landing_status` (text)
- `judge_notes` (text)
- `rover_bonus` (bool)
- `return_bonus` (bool)
- `aesthetics_bonus` (int)
- `additional_penalty` (int)
- `blueprint_url` (text)
- `blueprint_link` (text)
- `landing_frame_url` (text)

### `global_state` table
Expected single row (`id = 1`) with:
- `id` (int, pk)
- `timer_mode` (`IDLE | BUILD | FLIGHT`)
- `timer_start_time` (timestamptz)
- `is_running` (bool)
- `countdown_end` (timestamptz)
- `countdown_label` (text)

### `scores` table
Used for reset cleanup from Admin.

## Environment Variables

Create `.env.local`:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Local Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run lint
npm run build
npm run preview
```

## Supabase Requirements

1. Create public storage bucket: `blueprint`
2. Ensure RLS policies allow this app's anon client to:
- read/insert/update `participants`
- read/insert/update `global_state`
- manage `scores` if using Admin reset
- insert/read storage objects in `blueprint`

If these policies are missing, phase buttons and resets will fail.

## Route Map

- `/` -> Login
- `/admin` -> Admin dashboard
- `/participant` -> Participant console
- `/judge` -> Judge dashboard

## Notes

- This app currently uses simple client-side passcodes for Admin and Judge.
- For production use, move auth/authorization to proper Supabase Auth + role checks.
- UI includes credits and rulebook shortcut per current event branding.
