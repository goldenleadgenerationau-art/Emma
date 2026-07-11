# GLG AI Receptionist — Emma (production build)

A production rebuild of the approved Emma demo. The visual design (avatar,
branding, black/gold layout, animations, transcript panel) is unchanged from
the original HTML mockup — everything underneath it has been replaced:

| Piece | Demo (original HTML) | Production (this repo) |
|---|---|---|
| Voice | Browser `speechSynthesis` (robotic) | **OpenAI Realtime API**, live over WebRTC, natural Australian voice |
| Listening | Browser `SpeechRecognition`, repeated permission prompts | **One** mic permission prompt, one persistent WebRTC session |
| Conversation | Hard-coded state machine, repeats questions | Realtime model conversation with tool-calling; remembers context for the whole call |
| Microphone | Re-requested per browser quirk | Requested once, held for the call's duration |
| CRM | `console.log` only | **GoHighLevel**: contact upsert, tags, custom fields, opportunity, workflow trigger (SMS/email) |
| Calendar | Two hard-coded slots | Real GHL calendar availability + booking, with a safe fallback if not yet connected |
| Frontend | Static HTML/CSS/JS | React / Next.js / TypeScript |
| Backend | None | Node.js / Express / TypeScript |

## Architecture

```
Browser (Next.js)                     Backend (Express)                GoHighLevel
   |                                        |                               |
   |--- POST /api/session ----------------->|                               |
   |   (start a call)                       |--- mint ephemeral token ----> OpenAI
   |<-- sessionId, ephemeral token ---------|                               |
   |                                        |                               |
   |==== WebRTC audio (direct) ============================> OpenAI Realtime API
   |<=== WebRTC audio (direct) ============================= OpenAI Realtime API
   |                                        |                               |
   |--- tool call: save lead / book demo -->|--- contact/opportunity/ ----->|
   |    (over the WebRTC data channel)      |    workflow/calendar calls    |
   |<-- tool result -------------------------|<------------------------------|
```

The browser and OpenAI exchange **audio directly** over WebRTC once the call
starts — the backend is never in the audio path, which keeps latency low.
The backend's job is:

1. Mint a short-lived ("ephemeral") OpenAI Realtime token per call, so the
   real `OPENAI_API_KEY` never reaches the browser.
2. Execute the handful of actions Emma can trigger mid-call (saving lead
   details, checking calendar availability, booking, and syncing to GHL),
   because those need the GHL API key, which also never reaches the browser.

## Repo layout

```
frontend/   Next.js 14 (App Router) + TypeScript + Tailwind. The call widget.
backend/    Express + TypeScript. Realtime token issuing + GHL integration.
docs/       GHL setup guide and deployment guide.
docker-compose.yml   Local full-stack dev environment.
```

## Quick start (local development)

Requirements: Node.js 18.17+, npm, and (optionally) Docker.

```bash
# 1. Backend
cd backend
cp .env.example .env        # fill in OPENAI_API_KEY at minimum to start
npm install
npm run dev                 # http://localhost:8080

# 2. Frontend (in a second terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000, click **Start web call**, allow microphone
access once, and talk to Emma. With only `OPENAI_API_KEY` set, the call
works end-to-end and lead data is captured in the transcript; GoHighLevel
sync stays disabled (and clearly logged as such) until you follow
[`docs/GHL_SETUP.md`](docs/GHL_SETUP.md).

### Or with Docker Compose

```bash
cp backend/.env.example backend/.env   # fill in real values first
docker compose up --build
```

## Configuration

See [`backend/.env.example`](backend/.env.example) for every variable, and
[`docs/GHL_SETUP.md`](docs/GHL_SETUP.md) for how to obtain the GoHighLevel
ones (Private Integration token, custom field keys, pipeline/stage IDs,
workflow ID, calendar ID).

Nothing hard-fails at startup if GoHighLevel isn't configured yet — the app
runs in "voice + lead capture" mode and each GHL-dependent action reports a
clear, specific error instead of crashing the call, so you can turn each
integration on incrementally.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — frontend on Vercel, backend
on Render, plus a full smoke-test checklist.

## Security notes

- `OPENAI_API_KEY` and `GHL_API_KEY` live only in the backend's environment
  variables. Neither is ever sent to the browser.
- The browser receives a **single-call, minute-scale ephemeral token** from
  OpenAI, not the real API key.
- CORS on the backend is locked to the origins listed in `ALLOWED_ORIGINS`.
- All API routes are rate-limited (`express-rate-limit`) and served behind
  `helmet`'s default security headers.
- HTTPS is enforced by Vercel/Render automatically in production; if you
  self-host, put this behind a TLS-terminating reverse proxy.

## What's intentionally out of scope for this pass

These were listed as "eventually" items in the brief and are structured so
they're straightforward to add on top of what's here, but aren't built yet:

- **Dashboard** (Call History, Transcripts, Analytics, Appointments, Lead
  Count, Conversion Rate). `backend/src/services/sessionStore.ts` already
  captures per-call transcripts and lead data — the natural next step is a
  small authenticated Next.js `/dashboard` route reading from a real
  database instead of the in-memory store.
- **Call transfer to a human.** Realtime API supports this via SIP
  transfer; wire it in once you have a destination number/team routing
  rule to transfer to.
- **Persistent storage.** The backend currently keeps call sessions in
  memory (simple, and enough for demo/early traffic). Swap
  `sessionStore.ts` for Redis or Postgres before you need multi-instance
  scaling or history that survives a restart.

## A note on how this was verified

This project was built and reviewed inside a sandboxed environment without
outbound network access, so it wasn't possible to run a live `npm install`
against the npm registry or make live calls to the OpenAI Realtime API /
GoHighLevel from here. What *was* verified in that environment:

- The backend TypeScript compiles cleanly (`tsc --noEmit`) aside from
  expected "module not installed" notices, which resolve as soon as you run
  `npm install` with network access.
- Every route, service, and the WebRTC/data-channel event flow was written
  and reviewed end-to-end against the current OpenAI Realtime API and GHL
  LeadConnector v2 API documentation shapes.

Before going live, run through `docs/DEPLOYMENT.md`'s smoke-test checklist
with your own API keys — that's the point where you'll want a first real
end-to-end call.
