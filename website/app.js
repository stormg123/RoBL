const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://robl-t4dq.onrender.com'
const API_BASE = API_URL + '/api'

let session = null, user = null, chatId = null, chats = {}, msgCount = 0
let pluginConnected = false, pluginPollInterval = null, syncPollInterval = null
let pendingImage = null
let mode = 'build' // 'plan' or 'build'

const $ = id => document.getElementById(id)
const auth = $('auth'), sync = $('sync'), dashboard = $('dashboard')
const loginBtn = $('loginBtn'), logoutBtn = $('logoutBtn')
const prompt = $('prompt'), sendBtn = $('sendBtn')
const modelSelect = $('modelSelect')
const avatar = $('avatar'), displayName = $('displayName')
const pluginDot = $('pluginDot'), pluginText = $('pluginText')
const messages = $('messages'), chatScroll = $('chatScroll'), welcome = $('welcome')
const toastContainer = $('toastContainer')
const settingsBtn = $('settingsBtn'), settingsModal = $('settingsModal'), closeSettings = $('closeSettings')
const sidebarChats = $('sidebarChats'), newChatBtn = $('newChatBtn'), topbarTitle = $('topbarTitle')
const menuBtn = $('menuBtn'), toggleSidebarBtn = $('toggleSidebarBtn'), sidebar = $('sidebar')
const syncStatus = $('syncStatus')
const suggestionChips = $('suggestionChips')
const imageBtn = $('imageBtn'), imageInput = $('imageInput'), imageAttached = $('imageAttached'), removeImageBtn = $('removeImageBtn')
const nimModal = $('nimModal'), nimApiKey = $('nimApiKey'), nimSaveBtn = $('nimSaveBtn')
const createProjectBtn = $('createProjectBtn'), projectScreen = $('projectScreen'), chatArea = $('chatArea')
const themeSelect = $('themeSelect'), autoPlaytest = $('autoPlaytest'), autoFindBugs = $('autoFindBugs')
const settingsApiKey = $('settingsApiKey'), settingsSaveKey = $('settingsSaveKey')
const syncLock = $('syncLock')

// ==================== TOAST ====================
function toast(message, type = 'info', duration = 4000) {
    const el = document.createElement('div')
    el.className = `toast ${type}`
    el.textContent = message
    el.addEventListener('click', () => { el.classList.add('removing'); setTimeout(() => el.remove(), 300) })
    toastContainer.appendChild(el)
    setTimeout(() => { if (el.parentNode) { el.classList.add('removing'); setTimeout(() => el.remove(), 300) } }, duration)
}

// ==================== API KEY ====================
function getApiKey() {
    return localStorage.getItem('robl_nvkey') || ''
}

function setApiKey(val) {
    localStorage.setItem('robl_nvkey', val)
    if (nimApiKey) nimApiKey.value = val
    if (settingsApiKey) settingsApiKey.value = val
}

function syncApiKeyFields() {
    const k = getApiKey()
    if (nimApiKey) nimApiKey.value = k
    if (settingsApiKey) settingsApiKey.value = k
}

// ==================== NIM FIRST-TIME MODAL ====================
function checkNimModal() {
    if (!getApiKey()) {
        nimModal.style.display = 'flex'
        nimApiKey.focus()
    }
}

nimSaveBtn?.addEventListener('click', () => {
    const v = nimApiKey.value.trim()
    if (!v) return toast('Enter your NVIDIA NIM API key', 'error')
    setApiKey(v)
    nimModal.style.display = 'none'
    toast('API key saved', 'success')
    loadModels(v)
})

nimApiKey?.addEventListener('keydown', e => {
    if (e.key === 'Enter') nimSaveBtn?.click()
})

// Settings API key save
settingsSaveKey?.addEventListener('click', () => {
    const v = settingsApiKey.value.trim()
    if (!v) return toast('Enter your NVIDIA NIM API key', 'error')
    setApiKey(v)
    toast('API key saved', 'success')
    loadModels(v)
})

settingsApiKey?.addEventListener('keydown', e => {
    if (e.key === 'Enter') settingsSaveKey?.click()
})

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
        const clicked = sessionStorage.getItem('robl_dev_click')
        if (stored && clicked) { user = JSON.parse(stored); showSync(); return }
        localStorage.removeItem('robl_session')
        localStorage.removeItem('robl_dev_user')
        sessionStorage.removeItem('robl_dev_click')
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
    if (session && session.startsWith('dev-')) {
        startDevSync()
    }
}
function showDashboard() {
    setScreen('dashboard')
    if (user) {
        avatar.src = `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxId}&width=150&height=150&format=png`
        avatar.onerror = () => { avatar.src = '' }
    }
    syncApiKeyFields()
    loadSavedChats()
    renderSidebar()
    applyTheme()
    loadSettings()
    startPluginPolling()
    checkNimModal()
    updateSyncLock()
}

function setScreen(name) {
    [auth, sync, dashboard].forEach(s => s?.classList.remove('active'))
    const target = $(name)
    if (target) target.classList.add('active')
}

loginBtn.addEventListener('click', () => window.location.href = API_URL + '/auth/roblox')

document.getElementById('backdoorLink')?.addEventListener('click', (e) => {
    e.preventDefault()
    sessionStorage.setItem('robl_dev_click', '1')
    const fakeSession = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    localStorage.setItem('robl_session', fakeSession)
    localStorage.setItem('robl_dev_user', JSON.stringify({
        robloxId: '123456', displayName: 'DevUser', profileUrl: 'https://www.roblox.com/users/123456/profile',
    }))
    window.location.reload()
})

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('robl_session'); localStorage.removeItem('robl_dev_user')
    sessionStorage.removeItem('robl_dev_click')
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
    if (!session) return
    if (session.startsWith('dev-')) {
        const text = syncStatus?.querySelector('span')
        if (text) text.textContent = 'Simulating plugin sync...'
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
    pluginConnected = true
    const dot = syncStatus?.querySelector('.sync-dot')
    if (dot) dot.classList.add('connected')
    const text = syncStatus?.querySelector('span')
    if (text) text.textContent = 'Plugin connected!'
    setTimeout(() => showDashboard(), 600)
}

// Dev mode simulated sync
let devSyncTimer = null
function startDevSync() {
    if (devSyncTimer) clearTimeout(devSyncTimer)
    devSyncTimer = setTimeout(() => {
        onPluginSynced()
    }, 3500)
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

function updateSyncLock() {
    if (pluginConnected) {
        syncLock?.classList.remove('show')
        prompt.disabled = false
        sendBtn.disabled = false
    } else {
        syncLock?.classList.add('show')
        prompt.disabled = true
        sendBtn.disabled = true
    }
}

// ==================== MODE (plan / build) ====================
function updateModeIndicator() {
    const el = document.getElementById('modeIndicator')
    if (!el) return
    el.textContent = mode === 'plan' ? 'Plan' : 'Build'
    el.className = 'mode-indicator ' + mode
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.target.matches('textarea, input, select, [contenteditable]')) {
        e.preventDefault()
        mode = mode === 'plan' ? 'build' : 'plan'
        updateModeIndicator()
        toast(mode === 'plan' ? 'Planning mode — responses shown in chat' : 'Build mode — code sent to Studio', 'info', 2000)
    }
})

async function checkPlugin() {
    if (!session) return
    if (session.startsWith('dev-')) {
        pluginDot.className = 'plugin-dot online'
        pluginText.textContent = 'Dev mode'
        updateSyncLock()
        return
    }
    try {
        const r = await fetch(`${API_BASE}/plugin/status?session=${session}`)
        const data = await r.json()
        pluginConnected = !!data.connected
        if (data.connected) {
            pluginDot.className = 'plugin-dot online'
            pluginText.textContent = 'Studio connected'
        } else {
            pluginDot.className = 'plugin-dot'
            pluginText.textContent = 'Plugin offline'
        }
    } catch {
        pluginConnected = false
        pluginDot.className = 'plugin-dot'
        pluginText.textContent = 'Plugin offline'
    }
    updateSyncLock()
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
        sidebarChats.innerHTML = '<div class="sidebar-empty">No projects yet</div>'
        return
    }
    sidebarChats.innerHTML = ids.map(id => {
        const c = chats[id]
        const title = c.title || 'New project'
        const active = id === chatId ? ' active' : ''
        return `<div class="chat-item${active}" data-id="${id}">
            <span class="chat-item-title" data-title="${id}">${esc(title)}</span>
            <div class="chat-item-actions">
                <button class="chat-item-action rename" data-rename="${id}" title="Rename">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                </button>
                <button class="chat-item-action del" data-del="${id}" title="Delete">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>`
    }).join('')

    sidebarChats.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.chat-item-actions')) return
            switchChat(el.dataset.id)
        })
    })

    // Delete handlers
    sidebarChats.querySelectorAll('.chat-item-action.del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            deleteChat(btn.dataset.del)
        })
    })

    // Rename handlers
    sidebarChats.querySelectorAll('.chat-item-action.rename').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            startRename(btn.dataset.rename)
        })
    })
}

function startRename(id) {
    const chat = chats[id]
    if (!chat) return
    const span = document.querySelector(`.chat-item-title[data-title="${id}"]`)
    if (!span) return

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'chat-item-rename'
    input.value = chat.title || ''
    input.autofocus = true

    const finish = (save) => {
        if (save) {
            const val = input.value.trim()
            if (val) {
                chat.title = val
                chat.updated = Date.now()
                saveChats()
                renderSidebar()
                if (chatId === id) topbarTitle.textContent = val
            }
        }
        renderSidebar()
    }

    input.addEventListener('blur', () => finish(true))
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        if (e.key === 'Escape') { e.preventDefault(); finish(false) }
    })

    span.replaceWith(input)
    input.select()
}

function switchChat(id) {
    if (id === chatId) return
    chatId = id
    renderSidebar()
    renderMessages()
    topbarTitle.textContent = chats[id]?.title || 'New project'
}

function deleteChat(id) {
    const wasActive = chatId === id
    delete chats[id]
    if (wasActive) {
        chatId = null
        topbarTitle.textContent = 'Projects'
        const remaining = Object.keys(chats)
        if (remaining.length) chatId = remaining[0]
    }
    saveChats()
    renderSidebar()
    renderMessages()
    updateProjectScreen()
}

function newChat() {
    chatId = null
    topbarTitle.textContent = 'Projects'
    renderSidebar()
    renderMessages()
    updateProjectScreen()
}

newChatBtn.addEventListener('click', newChat)

// ==================== CREATE PROJECT FLOW ====================
function updateProjectScreen() {
    if (chatId && chats[chatId]) {
        projectScreen.style.display = 'none'
        chatArea.style.display = 'flex'
    } else {
        projectScreen.style.display = 'flex'
        chatArea.style.display = 'none'
    }
}

createProjectBtn?.addEventListener('click', () => {
    chatId = 'chat_' + Date.now()
    chats[chatId] = { title: 'New project', msgs: [], created: Date.now(), updated: Date.now() }
    saveChats()
    renderSidebar()
    topbarTitle.textContent = 'New project'
    updateProjectScreen()
    prompt.focus()
})

// ==================== MESSAGES ====================
function renderMessages() {
    messages.innerHTML = ''
    welcome.style.display = chatId && chats[chatId]?.msgs?.length ? 'none' : ''
    updateProjectScreen()

    if (!chatId || !chats[chatId]) return

    const msgs = chats[chatId].msgs || []
    msgs.forEach(m => appendMessageDOM(m.role, m.text, m.time, m.image, false))
    chatScroll.scrollTop = chatScroll.scrollHeight
}

function appendMessageDOM(role, text, time, image, animate = true) {
    welcome.style.display = 'none'
    const id = 'm-' + (++msgCount)

    let extra = ''
    let displayText = text
    if (role === 'ai') {
        if (text.startsWith('✅') || text.startsWith('✓')) {
            extra = `<div class="msg-success">${text}</div>`
            displayText = ''
        } else if (text.startsWith('Error') || text.startsWith('❌')) {
            extra = `<div class="msg-error">${text}</div>`
            displayText = ''
        }
    }

    let imageHtml = ''
    if (image) {
        imageHtml = `<img src="${image}" class="msg-image" alt="attached image">`
    }

    let avatarHtml = ''
    if (role === 'user') {
        const av = user?.displayName?.charAt(0) || 'U'
        avatarHtml = `<div class="msg-av">${av}</div>`
    }

    const html = `<div class="msg ${role}" id="${id}">
        ${avatarHtml}
        <div class="msg-bub">
            ${imageHtml}
            ${displayText ? `<div class="msg-text">${esc(displayText)}</div>` : ''}
            ${extra}
            <div class="msg-time">${time || new Date().toLocaleTimeString()}</div>
        </div>
    </div>`

    messages.insertAdjacentHTML('beforeend', html)
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight })
}

function addMessage(role, text, image) {
    const time = new Date().toLocaleTimeString()
    appendMessageDOM(role, text, time, image)

    if (!chatId) {
        chatId = 'chat_' + Date.now()
        chats[chatId] = { title: text.substring(0, 40), msgs: [], created: Date.now(), updated: Date.now() }
        renderSidebar()
        topbarTitle.textContent = chats[chatId].title
        updateProjectScreen()
    }
    if (!chats[chatId]) {
        chats[chatId] = { title: text.substring(0, 40), msgs: [], created: Date.now(), updated: Date.now() }
    }

    const c = chats[chatId]
    c.msgs.push({ role, text, time, image })
    c.updated = Date.now()
    if (role === 'user' && c.msgs.length === 1) {
        c.title = text.substring(0, 40)
        topbarTitle.textContent = c.title
        renderSidebar()
    }
    saveChats()
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

// ==================== IMAGE UPLOAD ====================
imageBtn?.addEventListener('click', () => imageInput?.click())

imageInput?.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
        pendingImage = ev.target.result
        imageAttached.style.display = 'inline-flex'
    }
    reader.readAsDataURL(file)
})

removeImageBtn?.addEventListener('click', () => {
    pendingImage = null
    imageAttached.style.display = 'none'
    imageInput.value = ''
})

// ==================== THINKING STAGES ====================
let thinkingEl = null
let stageTimers = {}

function showThinkingStages() {
    if (thinkingEl) thinkingEl.remove()
    const el = document.createElement('div')
    el.className = 'thinking'
    el.id = 'thinkingContainer'
    el.innerHTML = `
        <div class="thinking-header">
            <span class="thinking-spinner"></span>
            Processing request...
        </div>
        <div class="thinking-stages" id="thinkingStages">
            <div class="t-stage" data-stage="scan">
                <span class="t-icon">🔍</span>
                <span class="t-label">Scanning workspace...</span>
                <span class="t-status"></span>
            </div>
            <div class="t-stage" data-stage="research">
                <span class="t-icon">📚</span>
                <span class="t-label">Researching toolbox...</span>
                <span class="t-status"></span>
            </div>
            <div class="t-stage" data-stage="generate">
                <span class="t-icon">🧠</span>
                <span class="t-label">Generating Lua code...</span>
                <span class="t-status"></span>
            </div>
            <div class="t-stage" data-stage="validate">
                <span class="t-icon">🔬</span>
                <span class="t-label">Validating output...</span>
                <span class="t-status"></span>
            </div>
        </div>
    `
    messages.appendChild(el)
    chatScroll.scrollTop = chatScroll.scrollHeight
    return el
}

function updateStage(stageId, status, duration) {
    const stage = document.querySelector(`.t-stage[data-stage="${stageId}"]`)
    if (!stage) return
    const statusEl = stage.querySelector('.t-status')
    stage.className = 't-stage ' + status
    if (status === 'active') {
        const start = Date.now()
        stageTimers[stageId] = setInterval(() => {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            statusEl.textContent = elapsed + 's'
        }, 100)
        statusEl.textContent = '...'
    } else if (status === 'done') {
        if (stageTimers[stageId]) { clearInterval(stageTimers[stageId]); delete stageTimers[stageId] }
        statusEl.textContent = '✅ ' + duration + 's'
    } else if (status === 'error') {
        if (stageTimers[stageId]) { clearInterval(stageTimers[stageId]); delete stageTimers[stageId] }
        statusEl.textContent = '❌'
    }
}

function removeThinkingStages() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null }
    Object.values(stageTimers).forEach(clearInterval)
    stageTimers = {}
}

function parseSSEBuffer(buffer) {
    const events = []
    const blocks = buffer.split('\n\n')
    const remaining = blocks.pop() || ''
    for (const block of blocks) {
        if (!block.trim()) continue
        const lines = block.split('\n')
        let eventType = 'message'
        let data = ''
        for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) data = line.slice(6)
        }
        if (data) {
            try { events.push({ event: eventType, data: JSON.parse(data) }) } catch {}
        }
    }
    return { events, remaining }
}

// ==================== GENERATE ====================
async function generate() {
    const p = prompt.value.trim()
    const k = getApiKey()
    const m = modelSelect.value

    if (!p) { toast('Enter a prompt', 'error'); return }
    if (!k) { toast('Enter your NVIDIA NIM API key', 'error'); return }
    if (!session) { toast('You must be logged in', 'error'); return }
    if (!pluginConnected && mode !== 'plan') { toast('Wait for Studio plugin to connect', 'error'); return }

    const imageData = pendingImage
    pendingImage = null
    imageAttached.style.display = 'none'
    if (imageInput) imageInput.value = ''

    addMessage('user', p, imageData)
    prompt.value = ''
    prompt.style.height = 'auto'
    sendBtn.disabled = true
    sendBtn.classList.add('loading')

    showThinkingStages()

    try {
        const r = await fetch(`${API_BASE}/generate?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, apiKey: k, model: m, image: imageData, stream: true, mode }),
        })

        if (!r.ok) {
            const errData = await r.json().catch(() => ({}))
            throw new Error(errData.error || 'Generation failed')
        }

        const reader = r.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const { events, remaining } = parseSSEBuffer(buffer)
            buffer = remaining

            for (const ev of events) {
                if (ev.event === 'stage') {
                    updateStage(ev.data.id, ev.data.status, ev.data.duration)
                    chatScroll.scrollTop = chatScroll.scrollHeight
                } else if (ev.event === 'text') {
                    addMessage('ai', ev.data.code)
                    chatScroll.scrollTop = chatScroll.scrollHeight
                } else if (ev.event === 'complete') {
                    removeThinkingStages()
                    if (mode === 'plan') {
                        toast('Planning complete (' + ev.data.totalTime + 's)', 'success')
                    } else {
                        addMessage('ai', `✅ Sent to Studio`)
                        toast('Code sent to Roblox Studio (' + ev.data.totalTime + 's)', 'success')
                    }
                } else if (ev.event === 'error') {
                    removeThinkingStages()
                    addMessage('ai', `❌ ${ev.data.message}`)
                    toast(ev.data.message, 'error')
                }
            }
        }
    } catch (err) {
        removeThinkingStages()
        addMessage('ai', `❌ ${err.message}`)
        toast(err.message, 'error')
    } finally {
        sendBtn.disabled = false
        sendBtn.classList.remove('loading')
        updateSyncLock()
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
settingsBtn.addEventListener('click', () => {
    syncApiKeyFields()
    settingsModal.style.display = 'flex'
})
closeSettings.addEventListener('click', () => { settingsModal.style.display = 'none' })
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.style.display = 'none' })

// Theme
function applyTheme() {
    const t = localStorage.getItem('robl_theme') || 'dark'
    document.body.classList.toggle('light-theme', t === 'light')
    if (themeSelect) themeSelect.value = t
}

themeSelect?.addEventListener('change', e => {
    localStorage.setItem('robl_theme', e.target.value)
    applyTheme()
})

// Auto playtest / auto find bugs
function loadSettings() {
    if (autoPlaytest) autoPlaytest.checked = localStorage.getItem('robl_playtest') !== 'false'
    if (autoFindBugs) autoFindBugs.checked = localStorage.getItem('robl_findbugs') !== 'false'
}

autoPlaytest?.addEventListener('change', () => {
    localStorage.setItem('robl_playtest', autoPlaytest.checked)
})

autoFindBugs?.addEventListener('change', () => {
    localStorage.setItem('robl_findbugs', autoFindBugs.checked)
})

// ==================== SIDEBAR TOGGLE ====================
menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('closed')
})
toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('closed')
})

document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target) && !sidebar.classList.contains('closed')) {
        sidebar.classList.add('closed')
    }
})

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', checkAuth)
