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
    if (sessionId && sessionId.startsWith('dev-') && !sessions[sessionId]) {
        sessions[sessionId] = { robloxId: '123456', displayName: 'DevUser' };
    }
    const session = sessions[sessionId];
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const { prompt, apiKey, model, image } = req.body;
    if (!prompt || !apiKey) {
        return res.status(400).json({ error: 'Prompt and API key are required.' });
    }

    // If stream=true is requested, use SSE; otherwise return JSON directly
    if (req.body.stream) {
        return handleStreamingGenerate(req, res, session, prompt, apiKey, model, image);
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

async function callNVIDIA(messages, apiKey, model, maxTokens = 4096) {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: model || 'nvidia/llama-3.1-nemotron-70b-instruct',
            messages,
            temperature: 0.7,
            max_tokens: maxTokens,
            stream: false,
        }),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error('NVIDIA NIM API error: ' + errText);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

async function handleStreamingGenerate(req, res, session, prompt, apiKey, model, image) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const startTime = Date.now();
    const mode = req.body.mode || 'build';

    try {
        if (mode === 'plan') {
            const planSysPrompt = 'You are a Roblox development advisor. Discuss ideas with the user conversationally. Be helpful and creative. When you suggest a specific script idea, wrap each one as [BUILD: brief description] so it can be turned into a real script. Do NOT generate raw Lua code.';
            const planMsg = image
                ? { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }
                : { role: 'user', content: prompt };
            const planResponse = await callNVIDIA([{ role: 'system', content: planSysPrompt }, planMsg], apiKey, model);

            const recommendations = [];
            const buildRe = /\[BUILD:\s*(.*?)\]/g;
            let m;
            while ((m = buildRe.exec(planResponse)) !== null) {
                recommendations.push({ label: m[1], prompt: m[1] });
            }
            const cleanText = planResponse.replace(/\[BUILD:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            sendEvent('text', { text: cleanText, recommendations });
            sendEvent('complete', { success: true, plan: true, totalTime });
        } else {
            // Intent classification — is this a build request or casual chat?
            const intentPrompt = `Reply ONLY with the word "build" or "chat". Reply "build" if the user wants to CREATE, MAKE, GENERATE, or SCRIPT something in Roblox Studio (like making a sword, creating a door, writing a script, building a game). Reply "chat" ONLY for greetings like "hi", casual conversation, or things completely unrelated to Roblox. Do NOT explain — just one word.
Examples: "make a sword" → build | "create a door" → build | "write a script" → build | "hi" → chat | "what can you do" → chat
User: ${prompt}`;
            const intentResponse = await callNVIDIA([
                { role: 'system', content: 'Output ONLY the single word "build" or "chat" with no other text.' },
                { role: 'user', content: intentPrompt }
            ], apiKey, model, 10);
            const isBuild = intentResponse.trim().toLowerCase().startsWith('build')
                || /\b(make|create|build|generate|script|code|spawn|add|insert)\b/i.test(prompt);

            if (!isBuild) {
                const chatSysPrompt = 'You are a helpful Roblox assistant. Respond conversationally and naturally. Do not generate Lua code.';
                const chatMsg = image
                    ? { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }
                    : { role: 'user', content: prompt };
                const chatResponse = await callNVIDIA([{ role: 'system', content: chatSysPrompt }, chatMsg], apiKey, model);
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                sendEvent('text', { text: chatResponse, recommendations: [] });
                sendEvent('complete', { success: true, plan: true, totalTime });
                res.end();
                return;
            }

            // Stage 1: Analyze — real AI analysis
            sendEvent('stage', { id: 'analyze', status: 'active' });
            const analysisSysPrompt = 'You are a Roblox Studio build planner. Analyze what the user wants built and identify: the key objects to create, which Roblox services are needed, and the main steps the script will perform. Keep it under 3 sentences.';
            const analysisMsg = { role: 'user', content: prompt };
            const analysis = await callNVIDIA([{ role: 'system', content: analysisSysPrompt }, analysisMsg], apiKey, model);
            sendEvent('stage', { id: 'analyze', status: 'done', duration: ((Date.now() - startTime) / 1000).toFixed(1) });

            // Stage 2: Generate — main AI codegen using analysis context
            sendEvent('stage', { id: 'generate', status: 'active' });
            const codeSysPrompt = 'You are an expert Roblox Lua developer integrated directly into Roblox Studio. Generate complete, production-ready Lua scripts that can be inserted and run immediately. The script must be fully self-contained and able to: manipulate the Studio workspace (move, resize, clone parts), create new instances from scratch (Parts, Scripts, GUI elements, etc.), fetch and insert models from the Roblox Toolbox, modify terrain and lighting, create and configure DataStore connections, and build complete game systems from a single prompt. Only output raw Lua code — no explanations, no markdown wrappers.';
            const codeMsg = image
                ? { role: 'user', content: [{ type: 'text', text: `${analysis}\n\nBuild this: ${prompt}` }, { type: 'image_url', image_url: { url: image } }] }
                : { role: 'user', content: `${analysis}\n\nBuild this: ${prompt}` };
            const generatedCode = await callNVIDIA([{ role: 'system', content: codeSysPrompt }, codeMsg], apiKey, model);
            const cleanCode = generatedCode.replace(/```lua\n?/g, '').replace(/```/g, '').trim();
            sendEvent('stage', { id: 'generate', status: 'done', duration: ((Date.now() - startTime) / 1000).toFixed(1) });

            // Stage 3: Prepare for Studio
            sendEvent('stage', { id: 'studio', status: 'active' });
            const codeId = generateCodeId();
            codes[codeId] = {
                code: cleanCode,
                prompt,
                timestamp: Date.now(),
                status: 'pending',
                robloxId: session.robloxId,
            };
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            sendEvent('stage', { id: 'studio', status: 'done', duration: ((Date.now() - startTime) / 1000).toFixed(1) });

            // Build a summary from the analysis
            const summary = analysis.length > 120 ? analysis.substring(0, 120) + '...' : analysis;
            sendEvent('complete', { success: true, codeId, prompt, totalTime, summary });
        }
        res.end();
    } catch (err) {
        console.error('Streaming generation error:', err);
        sendEvent('error', { message: err.message });
        res.end();
    }
}

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
