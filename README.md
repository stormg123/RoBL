# RoBl — AI Code Generator for Roblox Studio

Generate Lua scripts using NVIDIA NIM and push them directly to Roblox Studio via a plugin.

## Project Structure

```
Desktop/robl/
├── website/              # Frontend (deploy to Netlify)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── privacy.html
│   └── terms.html
├── api/                  # Backend (deploy to Render/Railway)
│   ├── server.js
│   └── package.json
└── plugin/               # Roblox Studio plugin (source .lua)
    └── RoBlPlugin.lua
```

---

## Step-by-Step Setup

### 1. Create a Roblox OAuth 2.0 App

1. Go to https://create.roblox.com/dashboard/credentials/oauth
2. Click **Create App**
3. Fill in these fields:

| Field | Development Value | Production Value |
|-------|------------------|-----------------|
| **App Name** | RoBl | RoBl |
| **Entry Link** | `http://localhost:3000` | `https://yoursite.netlify.app` |
| **Privacy Policy URL** | `http://localhost:3000/privacy.html` | `https://yoursite.netlify.app/privacy.html` |
| **Terms of Service URL** | `http://localhost:3000/terms.html` | `https://yoursite.netlify.app/terms.html` |
| **Callback/Redirect URI** | `http://localhost:3000/auth/roblox/callback` | `https://your-api.onrender.com/auth/roblox/callback` |

4. Set **Scopes** to `profile` (or `openid profile`)
5. After creation, copy the **Client ID** and **Client Secret**

### 2. Configure the Backend

Open `api/server.js` and replace these values at the top:

```js
const CLIENT_ID = 'YOUR_ROBLOX_OAUTH_CLIENT_ID'
const CLIENT_SECRET = 'YOUR_ROBLOX_OAUTH_CLIENT_SECRET'
```

### 3. Run Locally (Development)

```bash
cd api
npm install
npm start
```

- Backend starts at `http://localhost:3000`
- Open that URL in your browser

### 4. Configure the Frontend for Deployment

Open `website/app.js` and change the production API URL:

```js
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://your-api.onrender.com'  // ← change this to your backend URL
```

### 5. Deploy the Backend (API)

**Option A: Render.com (recommended)**
1. Push `api/` folder (or whole repo) to a GitHub repo
2. Go to https://dashboard.render.com → New Web Service
3. Connect your repo
4. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variable: `PORT=3000`
5. Deploy → you get a URL like `https://robl-api.onrender.com`

**Option B: Railway.app**
1. Push to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Railway auto-detects Node.js

### 6. Deploy the Frontend (Website)

1. Push `website/` folder to a GitHub repo
2. Go to https://app.netlify.com → Add new site → Import from GitHub
3. Select your repo
4. Deploy settings:
   - Base directory: `website`
   - Publish directory: `website`
   - No build command needed
5. Deploy → you get a URL like `https://yoursite.netlify.app`
6. (Optional) Set a custom domain

### 7. Update OAuth App with Production URLs

After deploying both frontend and backend, go back to the Roblox OAuth dashboard and update:

| Field | Production Value |
|-------|-----------------|
| **Entry Link** | `https://yoursite.netlify.app` |
| **Privacy Policy URL** | `https://yoursite.netlify.app/privacy.html` |
| **Terms of Service URL** | `https://yoursite.netlify.app/terms.html` |
| **Callback URI** | `https://your-api.onrender.com/auth/roblox/callback` |

### 8. Install the Roblox Studio Plugin

1. Open **Roblox Studio**
2. Go to **Plugins** → **Plugin Manager**
3. Click **Add from Folder**
4. Select the `plugin/` folder containing `RoBlPlugin.lua`
5. The **RoBl AI** toolbar button appears in Studio

### 9. How to Use

1. Start your backend: `cd api && npm start`
2. Open the website (Netlify URL or `http://localhost:3000`)
3. Click **Log in with Roblox** → authorize the app
4. Enter your **NVIDIA NIM API Key** and click **Save**
5. Type a prompt like "Create a part that changes color when touched"
6. Click **Generate** → AI writes the Lua code
7. Open **Roblox Studio** → click the **RoBl AI** toolbar button
8. Enter your **Roblox User ID** (from your profile URL) and click **Connect**
9. Back on the website, click **Send to Studio**
10. The plugin fetches the code and asks how to insert it (Script / LocalScript / Cancel)

### 10. Get an NVIDIA NIM API Key

1. Go to https://build.nvidia.com/explore/discover
2. Sign up or log in
3. Navigate to any model (e.g., Llama 3.1 Nemotron)
4. Click **Get API Key** → generate a new key
5. Copy the key starting with `nvapi-...`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| OAuth callback fails | Make sure the Callback URI in Roblox matches EXACTLY what's in server.js (including trailing slash) |
| Plugin can't connect | The plugin polls the API URL. Make sure the backend is running and accessible from Studio |
| "Failed to generate code" | Check your NVIDIA NIM API key is valid and has credits |
| CORS errors | The backend server has `cors()` middleware enabled — it should work for localhost |
| Login redirects to localhost | Change `API_URL` in `app.js` to your production backend URL |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/roblox` | Redirect to Roblox OAuth login |
| GET | `/auth/roblox/callback` | OAuth callback (exchanges code for token) |
| GET | `/api/me?session=...` | Get current user info |
| POST | `/api/generate` | Generate code via NVIDIA NIM |
| GET | `/api/code/latest?robloxId=...` | Get pending code for plugin |
| GET | `/api/health` | Health check |
