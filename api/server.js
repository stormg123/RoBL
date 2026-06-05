const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

// ============================================================
//  ROBLOX OAUTH 2.0 APP REGISTRATION - REQUIRED FIELDS
// ============================================================
// When you register your app at https://create.roblox.com/dashboard/credentials/oauth
// you need to fill in these fields:
//
//   Entry Link URL:     http://localhost:3000
//   Privacy Policy URL: http://localhost:3000/privacy.html
//   Terms of Service URL: http://localhost:3000/terms.html
//   Callback/Redirect URI: http://localhost:3000/auth/roblox/callback
//   Scopes:             profile (or openid profile)
// ============================================================

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_ROBLOX_OAUTH_CLIENT_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'YOUR_ROBLOX_OAUTH_CLIENT_SECRET';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REDIRECT_URI = BASE_URL + '/auth/roblox/callback';

const app = express();
app.use(cors({
    origin: ['http://localhost:3000', 'https://robl-t4dq.onrender.com', 'https://robl-ai.netlify.app'],
    credentials: true,
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../website')));

const users = {};
const codes = {};
const sessions = {};

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function generateCodeId() {
    return crypto.randomBytes(16).toString('hex');
}

// ============ AUTH ROUTES ============

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
    const { code, state } = req.query;
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
            console.error('Token exchange failed:', tokenData);
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

// ============ API ROUTES ============

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

app.post('/api/generate', async (req, res) => {
    const sessionId = req.query.session || req.headers['x-session-id'];
    const session = sessions[sessionId];
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const { prompt, apiKey, model } = req.body;
    if (!prompt || !apiKey) {
        return res.status(400).json({ error: 'Prompt and API key are required.' });
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
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert Roblox Lua developer. Generate high-quality, well-commented Lua code for Roblox Studio. Only output the code, no explanations.'
                    },
                    {
                        role: 'user',
                        content: `Generate Roblox Lua code for: ${prompt}`
                    }
                ],
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
            timestamp: Date.now(),
            status: 'pending',
            robloxId: session.robloxId,
        };

        res.json({
            success: true,
            code: generatedCode,
            codeId,
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
