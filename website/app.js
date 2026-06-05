// ==================== CONFIG ====================
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://robl-t4dq.onrender.com'

const API_BASE = API_URL + '/api'

let session = null
let user = null
let editor = null
let history = []
let currentCode = null

// ==================== DOM ====================
const $ = id => document.getElementById(id)
const auth = $('auth'), dashboard = $('dashboard')
const loginBtn = $('loginBtn'), logoutBtn = $('logoutBtn')
const prompt = $('prompt'), generateBtn = $('generateBtn'), regenBtn = $('regenerateBtn')
const modelSelect = $('modelSelect'), apiKey = $('apiKey'), saveKeyBtn = $('saveKeyBtn')
const output = $('output'), editorEl = $('editor'), copyBtn = $('copyBtn'), sendBtn = $('sendBtn')
const avatar = $('avatar'), displayName = $('displayName')
const statusDot = $('statusDot'), statusText = $('statusText')
const historyList = $('historyList'), toastContainer = $('toastContainer')
const navTabs = document.querySelectorAll('.nav-tab')
const tabPanels = {
    generate: $('tab-generate'),
    history: $('tab-history'),
    settings: $('tab-settings'),
}

// ==================== TOAST ====================
function toast(message, type = 'info', duration = 4000) {
    const icons = { success: '✓', error: '✕', info: '●' }
    const el = document.createElement('div')
    el.className = `toast toast-${type}`
    el.innerHTML = `
        <span class="toast-icon">${icons[type] || '●'}</span>
        <span class="toast-message">${message}</span>
        <div class="toast-progress" style="animation-duration:${duration}ms"></div>
    `
    el.addEventListener('click', () => {
        el.classList.add('removing')
        setTimeout(() => el.remove(), 250)
    })
    toastContainer.appendChild(el)
    setTimeout(() => {
        if (el.parentNode) { el.classList.add('removing'); setTimeout(() => el.remove(), 250) }
    }, duration)
}

// ==================== STORAGE ====================
function loadKey() {
    const k = localStorage.getItem('robl_nvkey')
    if (k) apiKey.value = k
}
function saveKey() {
    const v = apiKey.value.trim()
    if (!v) return toast('Enter an API key first', 'error')
    localStorage.setItem('robl_nvkey', v)
    toast('API key saved', 'success')
}
saveKeyBtn.addEventListener('click', saveKey)

function getModel() { return localStorage.getItem('robl_model') || modelSelect.value }
function setModel(v) { localStorage.setItem('robl_model', v) }
modelSelect.addEventListener('change', () => setModel(modelSelect.value))

// ==================== AUTH ====================
function getSession() {
    const p = new URLSearchParams(window.location.search)
    const s = p.get('session') || localStorage.getItem('robl_session')
    if (p.get('session')) {
        localStorage.setItem('robl_session', p.get('session'))
        window.history.replaceState({}, '', '/')
    }
    return s
}

async function checkAuth() {
    session = getSession()
    if (!session) return showAuth()
    try {
        const r = await fetch(`${API_BASE}/me?session=${session}`)
        if (!r.ok) { localStorage.removeItem('robl_session'); return showAuth() }
        user = await r.json()
        showDashboard()
    } catch {
        showAuth()
    }
}

function showAuth() {
    auth.classList.add('active'); dashboard.classList.remove('active')
}
function showDashboard() {
    auth.classList.remove('active'); dashboard.classList.add('active')
    if (user) {
        avatar.src = `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxId}&width=150&height=150&format=png`
        avatar.onerror = () => { avatar.src = '' }
        displayName.textContent = user.displayName
    }
    initEditor()
    pollStatus()
    setInterval(pollStatus, 5000)
}

loginBtn.addEventListener('click', () => window.location.href = API_URL + '/auth/roblox')

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('robl_session'); session = null; user = null; showAuth()
})

// ==================== TABS ====================
navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        navTabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        Object.keys(tabPanels).forEach(k => tabPanels[k].classList.remove('active'))
        const panel = tabPanels[tab.dataset.tab]
        if (panel) panel.classList.add('active')
    })
})

// ==================== EDITOR ====================
function initEditor() {
    if (editor) return
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs' } })
    require(['vs/editor/editor.main'], () => {
        editor = monaco.editor.create(editorEl, {
            value: '-- Your generated code will appear here',
            language: 'lua',
            theme: 'vs-dark',
            fontSize: 14,
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
            lineNumbers: 'on',
            minimap: { enabled: false },
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 16 },
        })
    })
}

// ==================== GENERATE ====================
async function generate() {
    const p = prompt.value.trim()
    const k = apiKey.value.trim() || localStorage.getItem('robl_nvkey') || ''
    const m = modelSelect.value

    if (!p) { toast('Please enter a prompt', 'error'); return }
    if (!k) { toast('Enter your NVIDIA NIM API key in the field above', 'error'); return }

    if (!session) { toast('You must be logged in to generate code', 'error'); return }

    generateBtn.classList.add('loading')
    generateBtn.textContent = 'Generating'

    try {
        const r = await fetch(`${API_BASE}/generate?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, apiKey: k, model: m }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Generation failed')

        currentCode = data
        showCode(data.code)

        const item = { id: data.codeId, prompt: p, code: data.code, date: Date.now() }
        history.unshift(item)
        renderHistory()

        toast('Code generated successfully', 'success')
    } catch (err) {
        toast(err.message, 'error')
    } finally {
        generateBtn.classList.remove('loading')
        generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generate'
    }
}

function showCode(code) {
    output.style.display = 'block'
    if (editor) editor.setValue(code)
    // Auto-send to Studio if toggle is on
    const autoSend = $('autoSend')
    if (autoSend && autoSend.checked) {
        toast('Code sent to Studio plugin', 'info')
    }
}

generateBtn.addEventListener('click', generate)
regenBtn.addEventListener('click', generate)

copyBtn.addEventListener('click', () => {
    if (!editor) return
    navigator.clipboard.writeText(editor.getValue()).then(
        () => toast('Copied to clipboard', 'success'),
        () => toast('Failed to copy', 'error'),
    )
})

sendBtn.addEventListener('click', () => {
    if (!currentCode) { toast('No code to send — generate something first', 'error'); return }
    toast('Code sent to Roblox Studio plugin', 'success')
})

prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate()
})

// ==================== HISTORY ====================
function renderHistory() {
    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <p>No code generated yet</p>
                <span>Write a prompt and generate your first script.</span>
            </div>`
        return
    }
    historyList.innerHTML = history.map(item => `
        <div class="history-item" data-id="${item.id}">
            <h4>${esc(item.prompt.substring(0, 80))}${item.prompt.length > 80 ? '...' : ''}</h4>
            <p>${esc(item.code.substring(0, 150))}${item.code.length > 150 ? '...' : ''}</p>
            <div class="history-meta">
                <span>${new Date(item.date).toLocaleDateString()}</span>
                <span>·</span>
                <span>Lua</span>
                <span>·</span>
                <span>${item.code.length} chars</span>
            </div>
        </div>
    `).join('')

    historyList.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', () => {
            const item = history.find(h => h.id === el.dataset.id)
            if (item) {
                prompt.value = item.prompt
                showCode(item.code)
                currentCode = { codeId: item.id, code: item.code }
                // Switch to generate tab
                navTabs.forEach(t => t.classList.remove('active'))
                document.querySelector('[data-tab="generate"]').classList.add('active')
                Object.keys(tabPanels).forEach(k => tabPanels[k].classList.remove('active'))
                tabPanels.generate.classList.add('active')
            }
        })
    })
}

function esc(s) {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML
}

// ==================== POLL ====================
async function pollStatus() {
    try {
        const r = await fetch(`${API_BASE}/health`)
        if (r.ok) {
            statusDot.className = 'status-dot online'
            statusText.textContent = 'Connected'
        } else {
            statusDot.className = 'status-dot'
            statusText.textContent = 'Offline'
        }
    } catch {
        statusDot.className = 'status-dot connecting'
        statusText.textContent = 'Connecting...'
    }
}

// ==================== SETTINGS ====================
$('defaultModel')?.addEventListener('change', e => setModel(e.target.value))
$('editorTheme')?.addEventListener('change', e => {
    const theme = e.target.value
    if (editor) monaco.editor.setTheme(theme)
    localStorage.setItem('robl_theme', theme)
})

// Load saved theme
const savedTheme = localStorage.getItem('robl_theme')
if (savedTheme && $('editorTheme')) {
    $('editorTheme').value = savedTheme
    if (editor) monaco.editor.setTheme(savedTheme)
}

// Load saved auto-send
const autoSend = $('autoSend')
if (autoSend) {
    const saved = localStorage.getItem('robl_autosend')
    if (saved === 'true') autoSend.checked = true
    autoSend.addEventListener('change', () => {
        localStorage.setItem('robl_autosend', autoSend.checked)
    })
}

// ==================== INIT ====================
loadKey()
document.addEventListener('DOMContentLoaded', checkAuth)
