# Deployment Guide (Socket.io + Vercel)

Since Vercel is a **Serverless** platform, it **cannot** host the custom long-running `server.js` (Socket.io) process. We must use a **Split Deployment Strategy**.

## 1. Frontend (Next.js) -> Vercel
Host the main React application on Vercel.

1.  Push your code to GitHub.
2.  Import project in Vercel.
3.  **Environment Variables**:
    *   `NEXT_PUBLIC_SUPABASE_URL`: (Your URL)
    *   `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (Your Key)
    *   `NEXT_PUBLIC_SOCKET_URL`: **(Wait for Step 2)** - e.g. `https://my-socket-server.up.railway.app`

## 2. Backend (Socket.io) -> Railway / Render
Host the `server.js` on a platform that supports persistent Node.js apps. **Railway** is recommended for ease of use.

### Option A: Railway (Recommended)
1.  Sign up at [railway.app](https://railway.app).
2.  Create "New Project" -> "Deploy from GitHub repo".
3.  **Config**:
    *   Railway usually auto-detects `package.json`.
    *   **Start Command**: `node server.js`
4.  **Variables** (Add in Railway Dashboard):
    *   `NEXT_PUBLIC_SUPABASE_URL`: (Same as Vercel)
    *   `SUPABASE_SERVICE_ROLE_KEY`: (Your Service Role Key)
    *   `PORT`: `3000` (Railway sets this, ensure server listens on `process.env.PORT || 3001` - **Action Required: Update server.js**)

### Option B: Render (Alternative)
1.  Sign up at [render.com](https://render.com).
2.  Click "New" -> "Web Service".
3.  Connect your GitHub repository.
4.  **Settings**:
    *   **Runtime**: Node
    *   **Build Command**: `npm install`
    *   **Start Command**: `node server.js`
5.  **Environment Variables**:
    *   `NEXT_PUBLIC_SUPABASE_URL`: (Same as Vercel)
    *   `SUPABASE_SERVICE_ROLE_KEY`: (Your Service Role Key)
    *   (Render automatically injects `PORT`)

## 3. Link Them
1.  Get the **Public URL** of your Railway service (e.g. `https://coms-production.up.railway.app`).
2.  Go back to **Vercel Dashboard**.
3.  Set `NEXT_PUBLIC_SOCKET_URL` to that Railway URL.
4.  Redeploy Vercel.

    *   `SUPABASE_SERVICE_ROLE_KEY`: (Your Service Role Key)
    *   (Render automatically injects `PORT`)

## 4. Updates for Production
I have updated `server.js` to listen on `process.env.PORT` to be compatible with Railway/Render.

## 5. Troubleshooting (Render)

### Error: "Collecting page data..." or "Next.js Build Failed"
*   **Cause**: Render is trying to build the Frontend (Next.js) instead of just running the Backend.
*   **Fix**: Go to **Settings > Build & Deploy** and change **Build Command** to `npm install`.

### Error: "supabaseKey is required" or "Missing Supabase Env Vars"
*   **Cause**: Environment variables are missing or misnamed.
*   **Fix**: Go to **Environment** tab. Ensure:
    *   `NEXT_PUBLIC_SUPABASE_URL` is set.
    *   `SUPABASE_SERVICE_ROLE_KEY` is set.
    *   **No trailing spaces** (often happens when pasting).
