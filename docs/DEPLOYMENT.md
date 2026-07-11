# Deployment guide

Frontend → **Vercel**. Backend → **Render**. Both also run locally with Docker
Compose (see the root `README.md`) if you'd rather self-host.

## 1. Backend on Render

1. Push this repo to GitHub/GitLab.
2. In Render: **New → Web Service**, point it at the repo, set:
   - **Root directory**: `backend`
   - **Environment**: Node
   - **Build command**: `npm install && npm run build`
   - **Start command**: `npm start`
   - **Instance type**: Starter is fine to begin with; the app is stateless
     enough to scale horizontally once you swap the in-memory session store
     for Redis (see `backend/src/services/sessionStore.ts`).
3. Add every variable from `backend/.env.example` under **Environment**.
   Set `ALLOWED_ORIGINS` to your Vercel URL once you know it (you can update
   this after step 2 below and redeploy).
4. Deploy, then confirm `GET https://<your-render-app>.onrender.com/api/health`
   returns `{ "ok": true, ... }`.

Alternatively, Render can build straight from `backend/Dockerfile` if you
prefer container deploys - select **Docker** as the environment and point the
Dockerfile path at `backend/Dockerfile`.

## 2. Frontend on Vercel

1. In Vercel: **New Project**, import the same repo, set:
   - **Root directory**: `frontend`
   - **Framework preset**: Next.js (auto-detected)
2. Add environment variable `NEXT_PUBLIC_BACKEND_URL` = your Render backend
   URL from step 1 (e.g. `https://glg-emma-backend.onrender.com`).
3. Deploy. Vercel gives you a `https://<project>.vercel.app` URL.
4. Go back to Render and set `ALLOWED_ORIGINS` to include that Vercel URL
   (plus your custom domain once you attach one), then redeploy the backend.

## 3. Custom domain

Point your subdomain (e.g. `talktoemma.goldenleadgeneration.com.au`) at the
Vercel project via Vercel's domain settings, and add it to `ALLOWED_ORIGINS`
on the backend.

## 4. Smoke test checklist

Run through this after every deploy:

- [ ] `GET /api/health` on the backend returns `ok: true`
- [ ] Loading the frontend shows the approved Emma layout with no console
      errors
- [ ] "Start web call" prompts for microphone access exactly once
- [ ] Emma greets the caller within a couple of seconds
- [ ] Speaking a lead qualification answer updates the transcript live
- [ ] Ending the call and starting a new one works without a page reload
- [ ] A completed call creates/updates a contact in GoHighLevel with the
      right tags and custom fields (see `docs/GHL_SETUP.md` to verify)

## 5. Local self-hosting with Docker Compose

```bash
cp backend/.env.example backend/.env   # fill in real values
docker compose up --build
```

Frontend: http://localhost:3000 · Backend: http://localhost:8080
