const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://robl-t4dq.onrender.com'
const API_BASE = API_URL + '/api'

let session = null, user = null, chatId = null, chats = {}, msgCount = 0
let pluginConnected = false, pluginPollInterval = null, syncPollInterval = null

const $ = id => document.getElementById(id)
const auth = $('auth'), sync = $('sync'), dashboard = $('dashboard')
const loginBtn = $('loginBtn'), logoutBtn = $('logoutBtn')
const prompt = $('prompt'), sendBtn = $('sendBtn')
const modelSelect = $('modelSelect'), apiKey = $('apiKey'), saveKeyBtn = $('saveKeyBtn')
const avatar = $('avatar'), displayName = $('displayName')
const pluginDot = $('pluginDot'), pluginText = $('pluginText')
const messages = $('messages'), chatScroll = $('chatScroll'), welcome = $('welcome')
const toastContainer = $('toastContainer')
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal'), closeSettings = $('closeSettings')
const sidebarChats = $('sidebarChats'), newChatBtn = $('newChatBtn'), topbarTitle = $('topbarTitle')
const menuBtn = $('menuBtn'), toggleSidebarBtn = $('toggleSidebarBtn'), sidebar = $('sidebar')
const syncStatus = $('syncStatus'), syncUserId = $('syncUserId'), pluginDotSync = $('syncStatus')?.querySelector('.sync-dot')
const suggestionChips = $('suggestionChips')

// ==================== TOAST ====================
function toast(message, type = 'info', duration = 3000) {
    const el = document.createElement('div')
    el.className = `toast ${type}`
    el.textContent = message
    el.addEventListener('click', () => { el.classList.add('removing'); setTimeout(() => el.remove(), 200) })
    toastContainer.appendChild(el)
    setTimeout(() => { if (el.parentNode) { el.classList.add('removing'); setTimeout(() => el.remove(), 200) } }, duration)
}

// ==================== STORAGE ====================
function loadKey() { const k = localStorage.getItem('robl_nvkey'); if (k) apiKey.value = k }
function saveKey() {
    const v = apiKey.value.trim()
    if (!v) return toast('Enter an API key', 'error')
    localStorage.setItem('robl_nvkey', v)
    toast('API key saved', 'success')
    loadModels(v)
}
saveKeyBtn.addEventListener('click', saveKey)
apiKey.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey() })

// ==================== MODELS ====================
async function loadModels(key) {
    const headers = {}
    if (key) headers['x-api-key'] = key
    try {
        const r = await fetch(`${API_BASE}/models`, { headers })
        const data = await r.json()
        if (data.models && data.models.length) {
            modelSelect.innerHTML = data.models.map(m =>
                `<option value="${m.id}">${m.name}</option>`
            ).join('')
            const saved = localStorage.getItem('robl_model')
            if (saved) modelSelect.value = saved
        }
    } catch {}
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

    if (session.startsWith('dev-')) {
        const stored = localStorage.getItem('robl_dev_user')
        if (stored) { user = JSON.parse(stored); showSync(); return }
        return showAuth()
    }

    try {
        const r = await fetch(`${API_BASE}/me?session=${session}`)
        if (!r.ok) { localStorage.removeItem('robl_session'); return showAuth() }
        user = await r.json()
        showSync()
    } catch { showAuth() }
}

function showAuth() { setScreen('auth') }
function showSync() {
    setScreen('sync')
    displayName.textContent = user.displayName
    syncUserId.textContent = user.robloxId
    startSyncPolling()
}
function showDashboard() {
    setScreen('dashboard')
    if (user) {
        avatar.src = `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxId}&width=150&height=150&format=png`
        avatar.onerror = () => { avatar.src = '' }
    }
    loadKey()
    loadSavedChats()
    renderSidebar()
    startPluginPolling()
}

function setScreen(name) {
    [auth, sync, dashboard].forEach(s => s?.classList.remove('active'))
    const target = $(name)
    if (target) target.classList.add('active')
}

loginBtn.addEventListener('click', () => window.location.href = API_URL + '/auth/roblox')

document.getElementById('backdoorLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    const fakeSession = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    localStorage.setItem('robl_session', fakeSession)
    localStorage.setItem('robl_dev_user', JSON.stringify({
        robloxId: '123456', displayName: 'DevUser', profileUrl: 'https://www.roblox.com/users/123456/profile',
    }))
    window.location.reload()
})

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('robl_session'); localStorage.removeItem('robl_dev_user')
    session = null; user = null
    stopPluginPolling(); stopSyncPolling()
    showAuth()
})

// ==================== SYNC POLLING ====================
function startSyncPolling() {
    stopSyncPolling()
    syncPollInterval = setInterval(checkPluginSync, 2000)
    checkPluginSync()
}

function stopSyncPolling() {
    if (syncPollInterval) { clearInterval(syncPollInterval); syncPollInterval = null }
}

async function checkPluginSync() {
    if (!session || session.startsWith('dev-')) {
        onPluginSynced()
        return
    }
    try {
        const r = await fetch(`${API_BASE}/plugin/status?session=${session}`)
        const data = await r.json()
        if (data.connected) {
            onPluginSynced()
        }
    } catch {}
}

function onPluginSynced() {
    stopSyncPolling()
    const dot = syncStatus?.querySelector('.sync-dot')
    if (dot) dot.classList.add('connected')
    const text = syncStatus?.querySelector('span')
    if (text) text.textContent = 'Plugin connected!'
    setTimeout(() => showDashboard(), 600)
}

// ==================== PLUGIN POLLING ====================
function startPluginPolling() {
    stopPluginPolling()
    pluginPollInterval = setInterval(checkPlugin, 5000)
    checkPlugin()
}

function stopPluginPolling() {
    if (pluginPollInterval) { clearInterval(pluginPollInterval); pluginPollInterval = null }
}

async function checkPlugin() {
    if (!session) return
    if (session.startsWith('dev-')) { pluginDot.className = 'plugin-dot online'; pluginText.textContent = 'Dev mode'; return }
    try {
        const r = await fetch(`${API_BASE}/plugin/status?session=${session}`)
        const data = await r.json()
        if (data.connected) {
            pluginDot.className = 'plugin-dot online'
            pluginText.textContent = 'Studio connected'
            pluginConnected = true
        } else {
            pluginDot.className = 'plugin-dot'
            pluginText.textContent = 'Plugin offline'
            pluginConnected = false
        }
    } catch {
        pluginDot.className = 'plugin-dot'
        pluginText.textContent = 'Plugin offline'
        pluginConnected = false
    }
}

// ==================== SIDEBAR / CHATS ====================
function loadSavedChats() {
    try { chats = JSON.parse(localStorage.getItem('robl_chats') || '{}') } catch { chats = {} }
}

function saveChats() {
    localStorage.setItem('robl_chats', JSON.stringify(chats))
}

function renderSidebar() {
    const ids = Object.keys(chats).sort((a, b) => (chats[b].updated || 0) - (chats[a].updated || 0))
    if (!ids.length) {
        sidebarChats.innerHTML = '<div style="padding:16px;text-align:center;font-size:13px;color:var(--text-muted)">No chats yet</div>'
        return
    }
    sidebarChats.innerHTML = ids.map(id => {
        const c = chats[id]
        const title = c.title || 'New chat'
        const active = id === chatId ? ' active' : ''
        return `<div class="chat-item${active}" data-id="${id}">
            <span class="chat-item-title">${esc(title)}</span>
            <button class="chat-item-del" data-del="${id}">×</button>
        </div>`
    }).join('')

    sidebarChats.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.chat-item-del')) return
            switchChat(el.dataset.id)
        })
    })
    sidebarChats.querySelectorAll('.chat-item-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            deleteChat(btn.dataset.del)
        })
    })
}

function switchChat(id) {
    if (id === chatId) return
    chatId = id
    renderSidebar()
    renderMessages()
    topbarTitle.textContent = chats[id]?.title || 'New chat'
}

function deleteChat(id) {
    delete chats[id]
    if (chatId === id) {
        chatId = null
        topbarTitle.textContent = 'New chat'
        const remaining = Object.keys(chats)
        if (remaining.length) chatId = remaining[0]
    }
    saveChats()
    renderSidebar()
    renderMessages()
}

function newChat() {
    chatId = null
    topbarTitle.textContent = 'New chat'
    renderSidebar()
    renderMessages()
    prompt.focus()
}

newChatBtn.addEventListener('click', newChat)

// ==================== MESSAGES ====================
function renderMessages() {
    messages.innerHTML = ''
    welcome.style.display = chatId && chats[chatId]?.msgs?.length ? 'none' : ''

    if (!chatId || !chats[chatId]) return

    const msgs = chats[chatId].msgs || []
    msgs.forEach(m => appendMessageDOM(m.role, m.text, m.time, false))
    chatScroll.scrollTop = chatScroll.scrollHeight
}

function appendMessageDOM(role, text, time, animate = true) {
    welcome.style.display = 'none'
    const id = 'm-' + (++msgCount)
    const av = role === 'user'
        ? (user?.displayName?.charAt(0) || 'U')
        : 'A'

    let extra = ''
    if (role === 'ai') {
        if (text.startsWith('✅') || text.startsWith('✓')) {
            extra = `<div class="msg-success">${text}</div>`
            text = ''
        } else if (text.startsWith('Error') || text.startsWith('❌')) {
            extra = `<div class="msg-error">${text}</div>`
            text = ''
        }
    }

    const html = `<div class="msg ${role}" id="${id}"${animate ? '' : ''}>
        <div class="msg-av">${av}</div>
        <div class="msg-bub">
            ${role === 'ai' ? '<div class="msg-label">RoBl</div>' : ''}
            ${text ? `<div class="msg-text">${esc(text)}</div>` : ''}
            ${extra}
            <div class="msg-time">${time || new Date().toLocaleTimeString()}</div>
        </div>
    </div>`

    messages.insertAdjacentHTML('beforeend', html)
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight })
}

function addMessage(role, text) {
    const time = new Date().toLocaleTimeString()
    appendMessageDOM(role, text, time)

    if (!chatId) {
        chatId = 'chat_' + Date.now()
        chats[chatId] = { title: text.substring(0, 40), msgs: [], created: Date.now(), updated: Date.now() }
        renderSidebar()
        topbarTitle.textContent = chats[chatId].title
    }
    if (!chats[chatId]) {
        chats[chatId] = { title: text.substring(0, 40), msgs: [], created: Date.now(), updated: Date.now() }
    }

    const c = chats[chatId]
    c.msgs.push({ role, text, time })
    c.updated = Date.now()
    if (role === 'user' && c.msgs.length === 1) {
        c.title = text.substring(0, 40)
        topbarTitle.textContent = c.title
        renderSidebar()
    }
    saveChats()
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
    sendBtn.disabled = true
    sendBtn.classList.add('loading')

    try {
        const r = await fetch(`${API_BASE}/generate?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, apiKey: k, model: m }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Generation failed')

        addMessage('ai', `✅ Sent to Studio — plugin will insert the code`)
        toast('Code sent to Roblox Studio', 'success')
    } catch (err) {
        addMessage('ai', `❌ ${err.message}`)
        toast(err.message, 'error')
    } finally {
        sendBtn.disabled = false
        sendBtn.classList.remove('loading')
    }
}

sendBtn.addEventListener('click', generate)
prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate() }
})
prompt.addEventListener('input', () => {
    prompt.style.height = 'auto'
    prompt.style.height = Math.min(prompt.scrollHeight, 120) + 'px'
})

// ==================== SUGGESTIONS ====================
suggestionChips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip')
    if (!chip) return
    prompt.value = chip.dataset.prompt
    prompt.style.height = 'auto'
    prompt.style.height = Math.min(prompt.scrollHeight, 120) + 'px'
    prompt.focus()
    generate()
})

// ==================== SETTINGS ====================
settingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex' })
closeSettings.addEventListener('click', () => { settingsModal.style.display = 'none' })
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.style.display = 'none' })

$('themeSelect')?.addEventListener('change', e => {
    localStorage.setItem('robl_theme', e.target.value)
})

const savedTheme = localStorage.getItem('robl_theme')
if (savedTheme && $('themeSelect')) $('themeSelect').value = savedTheme

// ==================== SIDEBAR TOGGLE ====================
menuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('closed')) {
        sidebar.classList.remove('closed')
    } else {
        sidebar.classList.add('closed')
    }
})
toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('closed')
})

// Close sidebar on mobile when clicking outside
document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target) && !sidebar.classList.contains('closed')) {
        sidebar.classList.add('closed')
    }
})

// ==================== AUTO-RESIZE ====================
// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', checkAuth)
