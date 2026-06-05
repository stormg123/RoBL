const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://robl-t4dq.onrender.com'

const API_BASE = API_URL + '/api'

let session = null
let user = null
let editors = {}
let messages = []
let messageCounter = 0

const $ = id => document.getElementById(id)
const auth = $('auth'), dashboard = $('dashboard')
const loginBtn = $('loginBtn'), logoutBtn = $('logoutBtn')
const prompt = $('prompt'), generateBtn = $('generateBtn')
const modelSelect = $('modelSelect'), apiKey = $('apiKey'), saveKeyBtn = $('saveKeyBtn')
const avatar = $('avatar'), displayName = $('displayName')
const statusDot = $('statusDot'), statusText = $('statusText')
const chatMessages = $('chatMessages'), toastContainer = $('toastContainer')
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal'), closeSettings = $('closeSettings')
const tipsBanner = $('tipsBanner'), dismissTips = $('dismissTips')

// ==================== TOAST ====================
function toast(message, type = 'info', duration = 4000) {
    const icons = { success: '✓', error: '✕', info: '●' }
    const el = document.createElement('div')
    el.className = `toast toast-${type}`
    el.innerHTML = `<span class="toast-icon">${icons[type] || '●'}</span><span class="toast-message">${message}</span><div class="toast-progress" style="animation-duration:${duration}ms"></div>`
    el.addEventListener('click', () => { el.classList.add('removing'); setTimeout(() => el.remove(), 250) })
    toastContainer.appendChild(el)
    setTimeout(() => { if (el.parentNode) { el.classList.add('removing'); setTimeout(() => el.remove(), 250) } }, duration)
}

// ==================== STORAGE ====================
function loadKey() { const k = localStorage.getItem('robl_nvkey'); if (k) apiKey.value = k }
function saveKey() {
    const v = apiKey.value.trim()
    if (!v) return toast('Enter an API key first', 'error')
    localStorage.setItem('robl_nvkey', v)
    toast('API key saved', 'success')
    fetchModels()
}
saveKeyBtn.addEventListener('click', saveKey)
apiKey.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey() })

// ==================== MODELS ====================
async function fetchModels() {
    try {
        const r = await fetch(`${API_BASE}/models`)
        const data = await r.json()
        if (data.models) {
            modelSelect.innerHTML = data.models.map(m =>
                `<option value="${m.id}">${m.name}</option>`
            ).join('')
            const saved = localStorage.getItem('robl_model')
            if (saved) modelSelect.value = saved
        }
    } catch { }
}
modelSelect.addEventListener('change', () => localStorage.setItem('robl_model', modelSelect.value))

// ==================== AUTH ====================
function getSession() {
    const p = new URLSearchParams(window.location.search)
    const s = p.get('session') || localStorage.getItem('robl_session')
    if (p.get('session')) {
        localStorage.setItem('robl_session', p.get('session'))
        window.history.replaceState({}, '', '/login.html')
    }
    return s
}

async function checkAuth() {
    session = getSession()
    if (!session) return showAuth()

    // Dev backdoor — skip OAuth
    if (session.startsWith('dev-')) {
        const stored = localStorage.getItem('robl_dev_user')
        if (stored) {
            user = JSON.parse(stored)
            showDashboard()
            return
        }
        return showAuth()
    }

    try {
        const r = await fetch(`${API_BASE}/me?session=${session}`)
        if (!r.ok) { localStorage.removeItem('robl_session'); return showAuth() }
        user = await r.json()
        showDashboard()
    } catch { showAuth() }
}

function showAuth() { auth.classList.add('active'); dashboard.classList.remove('active') }

function showDashboard() {
    auth.classList.remove('active'); dashboard.classList.add('active')
    if (user) {
        avatar.src = `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxId}&width=150&height=150&format=png`
        avatar.onerror = () => { avatar.src = '' }
        displayName.textContent = user.displayName
    }
    loadKey()
    fetchModels()
    pollStatus()
    setInterval(pollStatus, 5000)
    initTips()
}

loginBtn.addEventListener('click', () => window.location.href = API_URL + '/auth/roblox')

// Backdoor dev access (bypasses OAuth for testing)
document.getElementById('backdoorLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    const fakeSession = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    localStorage.setItem('robl_session', fakeSession)
    localStorage.setItem('robl_dev_user', JSON.stringify({
        robloxId: '123456',
        displayName: 'DevUser',
        profileUrl: 'https://www.roblox.com/users/123456/profile',
    }))
    window.location.reload()
})

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('robl_session'); session = null; user = null; showAuth()
})

// ==================== TIPS ====================
function initTips() {
    if (localStorage.getItem('robl_tips_dismissed')) {
        tipsBanner.classList.add('hidden')
    }
}
dismissTips.addEventListener('click', () => {
    tipsBanner.classList.add('hidden')
    localStorage.setItem('robl_tips_dismissed', 'true')
})

// ==================== CHAT ====================
function addMessage(role, content, code, codeId) {
    const id = 'msg-' + (++messageCounter)
    const avatarLetter = role === 'user'
        ? (user?.displayName?.charAt(0) || 'U')
        : 'A'
    const avatarBg = role === 'user'
        ? 'background:linear-gradient(135deg,var(--accent),#00e5bf)'
        : 'background:linear-gradient(135deg,#6366f1,#818cf8)'

    let bubble = ''
    if (role === 'user') {
        bubble = `<div class="msg-bubble">${esc(content)}</div>`
    } else {
        let codeHtml = ''
        if (code) {
            codeHtml = `
                <div class="msg-code-header">
                    <span class="msg-code-lang"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Lua</span>
                    <span style="font-size:11px;color:var(--text-muted)">${code.length} chars</span>
                </div>
                <div id="editor-${id}" class="msg-code-editor"></div>
            `
        }
        const codeActions = code
            ? `<button class="msg-action-btn" onclick="copyCode('${id}')">Copy</button>
               <button class="msg-action-btn primary" onclick="sendToStudio('${id}')">Send to Studio</button>
               <button class="msg-action-btn" onclick="regenerate('${id}')">Regenerate</button>`
            : ''
        bubble = `<div class="msg-bubble">
            <div style="margin-bottom:6px;font-weight:600;font-size:13px;color:var(--accent)">RoBl</div>
            <div style="color:var(--text-secondary);font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(content)}</div>
            ${codeHtml}
            <div class="msg-actions">${codeActions}</div>
        </div>`
    }

    const html = `<div class="msg ${role}" id="${id}">
        <div class="msg-avatar" style="${avatarBg}">${avatarLetter}</div>
        ${bubble}
    </div>`

    chatMessages.insertAdjacentHTML('beforeend', html)
    messages.push({ id, role, content, code, codeId })

    // Hide welcome
    const welcome = chatMessages.querySelector('.chat-welcome')
    if (welcome) welcome.style.display = 'none'

    // Init editor if has code
    if (role === 'ai' && code) {
        initMsgEditor(id, code)
    }

    chatMessages.scrollTop = chatMessages.scrollHeight
    return id
}

function initMsgEditor(msgId, code) {
    const el = document.getElementById('editor-' + msgId)
    if (!el) return
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs' } })
    require(['vs/editor/editor.main'], () => {
        const editor = monaco.editor.create(el, {
            value: code,
            language: 'lua',
            theme: localStorage.getItem('robl_theme') || 'vs-dark',
            fontSize: 12,
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
            lineNumbers: 'on',
            minimap: { enabled: false },
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            readOnly: true,
            scrollBeyondLastLine: false,
        })
        editors[msgId] = editor
    })
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

// ==================== GENERATE ====================
async function generate() {
    const p = prompt.value.trim()
    const k = apiKey.value.trim() || localStorage.getItem('robl_nvkey') || ''
    const m = modelSelect.value

    if (!p) { toast('Enter a prompt', 'error'); return }
    if (!k) { toast('Enter your NVIDIA NIM API key', 'error'); return }
    if (!session) { toast('You must be logged in', 'error'); return }

    addMessage('user', p)
    prompt.value = ''
    prompt.style.height = 'auto'

    generateBtn.disabled = true
    generateBtn.classList.add('loading')

    try {
        const r = await fetch(`${API_BASE}/generate?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, apiKey: k, model: m }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Generation failed')

        addMessage('ai', data.code, data.code, data.codeId)
        toast('Code generated', 'success')
    } catch (err) {
        addMessage('ai', 'Error: ' + err.message)
        toast(err.message, 'error')
    } finally {
        generateBtn.disabled = false
        generateBtn.classList.remove('loading')
    }
}

generateBtn.addEventListener('click', generate)

prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate() }
})

prompt.addEventListener('input', () => {
    prompt.style.height = 'auto'
    prompt.style.height = Math.min(prompt.scrollHeight, 150) + 'px'
})

// ==================== SUGGESTIONS ====================
document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        prompt.value = chip.dataset.prompt
        prompt.style.height = 'auto'
        prompt.style.height = Math.min(prompt.scrollHeight, 150) + 'px'
        prompt.focus()
    })
})

// ==================== ACTIONS ====================
function getMsgData(msgId) {
    return messages.find(m => m.id === msgId)
}

window.copyCode = function(msgId) {
    const msg = getMsgData(msgId)
    if (!msg || !msg.code) return
    navigator.clipboard.writeText(msg.code).then(
        () => toast('Copied to clipboard', 'success'),
        () => toast('Failed to copy', 'error'),
    )
}

window.sendToStudio = function(msgId) {
    const msg = getMsgData(msgId)
    if (!msg || !msg.code) { toast('No code to send', 'error'); return }
    toast('Code sent to Roblox Studio plugin', 'success')
}

window.regenerate = async function(msgId) {
    const msg = getMsgData(msgId)
    if (!msg) return
    const k = apiKey.value.trim() || localStorage.getItem('robl_nvkey') || ''
    const m = modelSelect.value

    if (!k) { toast('Enter your NVIDIA NIM API key', 'error'); return }

    const btn = document.querySelector(`#${msgId} .msg-action-btn:last-child`)
    if (btn) { btn.textContent = 'Regenerating...'; btn.disabled = true }

    try {
        const r = await fetch(`${API_BASE}/generate?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: msg.content, apiKey: k, model: m }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Failed')

        // Update existing message
        const editorEl = document.getElementById('editor-' + msgId)
        if (editorEl && editors[msgId]) {
            editors[msgId].setValue(data.code)
            msg.code = data.code
            msg.codeId = data.codeId
        } else {
            // Replace the message
            const el = document.getElementById(msgId)
            if (el) el.remove()
            const idx = messages.indexOf(msg)
            if (idx > -1) messages.splice(idx, 1)
            addMessage('ai', data.code, data.code, data.codeId)
        }
        toast('Code regenerated', 'success')
    } catch (err) {
        toast(err.message, 'error')
    } finally {
        if (btn) { btn.textContent = 'Regenerate'; btn.disabled = false }
    }
}

// ==================== SETTINGS ====================
settingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex' })
closeSettings.addEventListener('click', () => { settingsModal.style.display = 'none' })
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.style.display = 'none' })

$('editorTheme')?.addEventListener('change', e => {
    const theme = e.target.value
    Object.values(editors).forEach(ed => monaco.editor.setTheme(theme))
    localStorage.setItem('robl_theme', theme)
})

const savedTheme = localStorage.getItem('robl_theme')
if (savedTheme && $('editorTheme')) $('editorTheme').value = savedTheme

const autoSend = $('autoSend')
if (autoSend) {
    const saved = localStorage.getItem('robl_autosend')
    if (saved === 'true') autoSend.checked = true
    autoSend.addEventListener('change', () => localStorage.setItem('robl_autosend', autoSend.checked))
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

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', checkAuth)
