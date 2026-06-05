const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_ROBLOX_OAUTH_CLIENT_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'YOUR_ROBLOX_OAUTH_CLIENT_SECRET';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REDIRECT_URI = BASE_URL + '/auth/roblox/callback';

const app = express();
app.use(cors({
    origin: ['http://localhost:3000', 'https://robl-t4dq.onrender.com', 'https://robl-gg.netlify.app'],
    credentials: true,
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../website')));

const users = {};
const codes = {};
const sessions = {};
const pluginConnections = {};

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function generateCodeId() {
    return crypto.randomBytes(16).toString('hex');
}

const FALLBACK_MODELS = [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', provider: 'NVIDIA' },
    { id: 'nvidia/llama-3.1-nemotron-8b-instruct', name: 'Nemotron 8B', provider: 'NVIDIA' },
    { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', provider: 'Meta' },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta' },
    { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B', provider: 'Google' },
];

// ============ AUTH ============

app.get('/auth/roblox', (req, res) => {
    const state = generateSessionId();
    const robloxAuthUrl = `https://auth.roblox.com/v2/login/authorize` +
        `?client_id=${CLIENT_ID}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=profile` +
        `&state=${state}` +
        `&nonce=${uuidv4()}`;
    res.redirect(robloxAuthUrl);
});

app.get('/auth/roblox/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code.');

    try {
        const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            return res.status(400).send('Failed to get access token.');
        }

        const userRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json();
        if (!userRes.ok || !userData.sub) {
            return res.status(400).send('Failed to get user info.');
        }

        const robloxId = String(userData.sub);
        const displayName = userData.preferred_username || userData.name || 'Roblox User';
        const profileUrl = `https://www.roblox.com/users/${robloxId}/profile`;

        users[robloxId] = { robloxId, displayName, profileUrl, token: tokenData.access_token };

        const sessionId = generateSessionId();
        sessions[sessionId] = { robloxId, createdAt: Date.now() };

        res.redirect(`/login.html?session=${sessionId}`);
    } catch (err) {
        console.error('OAuth error:', err);
        res.status(500).send('Authentication failed.');
    }
});

// ============ API ============

app.get('/api/me', (req, res) => {
    const sessionId = req.query.session || req.headers['x-session-id'];
    const session = sessions[sessionId];
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const user = users[session.robloxId];
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
        robloxId: user.robloxId,
        displayName: user.displayName,
        profileUrl: user.profileUrl,
    });
});

// Fetch models: try NVIDIA API, fall back to static list
app.get('/api/models', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
        try {
        const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) {
            const data = await r.json();
            const models = (data.data || []).map(m => ({
                id: m.id,
                name: m.id.split('/').pop() || m.id,
                provider: m.id.includes('/') ? m.id.split('/')[0] : 'NVIDIA',
            }));
            return res.json({ models });
        }
        } catch {}
    }
    res.json({ models: FALLBACK_MODELS });
});

// Plugin pings to mark as connected
app.post('/api/plugin/ping', (req, res) => {
    const { robloxId } = req.body;
    if (!robloxId) return res.status(400).json({ error: 'robloxId required' });
    pluginConnections[String(robloxId)] = { lastSeen: Date.now() };
    res.json({ ok: true });
});

// Check if plugin is connected for a session
app.get('/api/plugin/status', (req, res) => {
    const sessionId = req.query.session;
    const session = sessions[sessionId];
    if (!session) return res.json({ connected: false });
    const conn = pluginConnections[session.robloxId];
    const connected = conn && (Date.now() - conn.lastSeen < 30000);
    res.json({ connected: !!connected, robloxId: session.robloxId });
});

app.post('/api/generate', async (req, res) => {
    const sessionId = req.query.session || req.headers['x-session-id'];
    const session = sessions[sessionId];
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const { prompt, apiKey, model, image } = req.body;
    if (!prompt || !apiKey) {
        return res.status(400).json({ error: 'Prompt and API key are required.' });
    }

    const messages = [
        {
            role: 'system',
            content: 'You are an expert Roblox Lua developer. Generate high-quality, well-commented Lua code for Roblox Studio. Only output the raw code, no explanations or markdown.'
        }
    ];

    if (image) {
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: `Generate Roblox Lua code for: ${prompt}` },
                { type: 'image_url', image_url: { url: image } }
            ]
        });
    } else {
        messages.push({
            role: 'user',
            content: `Generate Roblox Lua code for: ${prompt}`
        });
    }

    try {
        const nvidiaResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model || 'nvidia/llama-3.1-nemotron-70b-instruct',
                messages,
                temperature: 0.7,
                max_tokens: 2048,
                stream: false,
            }),
        });

        if (!nvidiaResponse.ok) {
            const errText = await nvidiaResponse.text();
            return res.status(502).json({ error: 'NVIDIA NIM API error', details: errText });
        }

        const nvidiaData = await nvidiaResponse.json();
        let generatedCode = nvidiaData.choices?.[0]?.message?.content || 'No code generated.';
        generatedCode = generatedCode.replace(/```lua\n?/g, '').replace(/```/g, '').trim();

        const codeId = generateCodeId();
        codes[codeId] = {
            code: generatedCode,
            prompt,
            timestamp: Date.now(),
            status: 'pending',
            robloxId: session.robloxId,
        };

        res.json({
            success: true,
            codeId,
            prompt,
        });
    } catch (err) {
        console.error('Generation error:', err);
        res.status(500).json({ error: 'Failed to generate code.', details: err.message });
    }
});

app.get('/api/code/latest', (req, res) => {
    const robloxId = req.query.robloxId;
    if (!robloxId) return res.status(400).json({ error: 'robloxId required.' });

    const userCodes = Object.entries(codes)
        .filter(([_, c]) => c.robloxId === robloxId && c.status === 'pending')
        .sort((a, b) => b[1].timestamp - a[1].timestamp);

    if (userCodes.length === 0) {
        return res.json({ code: null });
    }

    const [codeId, codeData] = userCodes[0];
    codeData.status = 'fetched';

    res.json({
        code: codeData.code,
        codeId,
        prompt: codeData.prompt,
        timestamp: codeData.timestamp,
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
    console.log(`\n🧊 RoBl API running on ${BASE_URL}`);
    console.log(`   Entry Link (OAuth):   ${BASE_URL}`);
    console.log(`   Privacy Policy URL:   ${BASE_URL}/privacy.html`);
    console.log(`   Terms of Service URL: ${BASE_URL}/terms.html`);
    console.log(`   OAuth Callback URI:   ${REDIRECT_URI}\n`);
});
