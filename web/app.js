import init, {
    setup,
    SessionBuilder,
    DesktopSize,
    InputTransaction,
    DeviceEvent,
    Extension,
    ClipboardData,
} from '../pkg/rdp_client.js';

import { createLogger } from './lib/logger.js';
import { createSessionManager } from './lib/session.js';
import { createDashboard } from './lib/dashboard.js';
import { createConnectionModal } from './lib/modal.js';
import { api } from './lib/api.js';
import { revealIn } from './lib/reveal.js';

// ---- Elements ----
const dashboardScreen = document.getElementById('dashboard-screen');
const sessionScreen = document.getElementById('session-screen');
const connectionsGrid = document.getElementById('connections-grid');

const dashNavbarPill = document.querySelector('.dash-navbar .navbar-pill');
const sessionBody = document.getElementById('session-body');
const bootSplash = document.getElementById('boot-splash');

const statusEl = document.getElementById('status');
const statusDotEl = document.getElementById('status-dot');
const logEl = document.getElementById('log-panel');
const canvas = document.getElementById('rdp-screen');
const canvasStage = document.getElementById('canvas-stage');
const emptyHint = document.getElementById('empty-hint');
const reconnectBanner = document.getElementById('reconnect-banner');
const reconnectText = document.getElementById('reconnect-text');
const reconnectNowBtn = document.getElementById('reconnect-now-btn');
const shotFlash = document.getElementById('shot-flash');

const navbarCount = document.getElementById('navbar-count');

const sidebarHome = document.getElementById('sidebar-home');
const sidebarScreenshot = document.getElementById('sidebar-screenshot');
const sidebarDisconnect = document.getElementById('sidebar-disconnect');
const sidebarFullscreen = document.getElementById('sidebar-fullscreen');
const sidebarLogs = document.getElementById('sidebar-logs');
const sidebarFreezeAlerts = document.getElementById('sidebar-freeze-alerts');

const logsPanel = document.getElementById('logs-panel');
const logsBackdrop = document.getElementById('logs-backdrop');
const logsClose = document.getElementById('logs-close');
const logsCopy = document.getElementById('logs-copy');
const logsClear = document.getElementById('logs-clear');

const modal = createConnectionModal({
    overlayEl: document.getElementById('connection-modal'),
    formEl: document.getElementById('connection-form'),
    cancelBtn: document.getElementById('modal-cancel'),
    errorEl: document.getElementById('modal-error'),
});

// States that actually mean "the connection changed" - used to gate
// which onStateChange calls are allowed to touch dock-button disabled
// state (see handleSessionStateChange). Freeze-watchdog states
// ('frame-fresh', 'maybe-frozen', 'freeze-auto-reconnect',
// 'freeze-alerts-off') are deliberately excluded.
const LIFECYCLE_STATES = new Set(['connecting', 'connected', 'reconnecting', 'disconnected']);

const { log, clear, asText, setStatus, formatError } = createLogger(logEl, statusEl, statusDotEl);

let activeConnectionId = null; // id of the saved connection currently in session, if any

// ---- Session manager ----
const sessionManager = createSessionManager({
    canvas,
    SessionBuilder, DesktopSize, Extension, DeviceEvent, InputTransaction, ClipboardData,
    init, setup, log, setStatus, formatError,
    onStateChange: handleSessionStateChange,
    onScreenshot: async (connectionId, dataUrl) => {
        try { await api.update(connectionId, { lastScreenshot: dataUrl }); } catch (_) { /* non-critical */ }
    },
});

// ---- Screen switching ----
function showDashboard() {
    dashboardScreen.classList.add('active');
    sessionScreen.classList.remove('active');
    dashboard.refresh();
}

function showSession() {
    dashboardScreen.classList.remove('active');
    sessionScreen.classList.add('active');
    canvas.setAttribute('data-active', '1');
    emptyHint.style.display = 'none';
}

// ---- Dashboard ----
const dashboard = createDashboard({
    gridEl: connectionsGrid,
    onCountChange: (n) => {
        navbarCount.textContent = n === 0 ? 'No saved connections' : `${n} saved connection${n === 1 ? '' : 's'}`;
    },
    onAddNew: async () => {
        const result = await modal.open();
        if (!result) return;
        await startConnection(result);
    },
    onConnect: (conn) => connectToSaved(conn),
});

async function connectToSaved(conn) {
    try {
        const secret = await api.secret(conn.id);
        activeConnectionId = conn.id;
        showSession();
        await sessionManager.connect({
            destination: `${secret.host}:${secret.port}`,
            username: secret.username,
            password: secret.password,
            connectionId: conn.id,
        });
    } catch (e) {
        log(`Couldn't load saved credentials: ${formatError(e)}`, 'error');
    }
}

async function startConnection({ name, host, username, password, save }) {
    let connectionId = null;
    if (save) {
        try {
            const record = await api.create({ name, host, username, password });
            connectionId = record.id;
        } catch (e) {
            log(`Couldn't save connection: ${formatError(e)}`, 'error');
        }
    }
    activeConnectionId = connectionId;
    showSession();
    await sessionManager.connect({ destination: host, username, password, connectionId });
}

// ---- Session state -> UI ----
function handleSessionStateChange(state, detail) {
    // Only actual connection-lifecycle states get to touch whether the
    // dock buttons are enabled. The freeze watchdog fires 'frame-fresh'
    // repeatedly (every ~4s) for as long as the desktop is being
    // actively used, and previously this function reset both buttons to
    // disabled on *every single one* of those ticks - which is exactly
    // why Screenshot/Disconnect looked broken: they'd flip back to
    // disabled a few seconds after any real connect.
    if (LIFECYCLE_STATES.has(state)) {
        sidebarDisconnect.disabled = !(state === 'connected' || state === 'reconnecting');
        sidebarScreenshot.disabled = state !== 'connected';
    }

    if (state === 'connected') {
        reconnectBanner.classList.remove('visible', 'warn');
        emptyHint.style.display = 'none';
    }
    if (state === 'connecting') {
        emptyHint.textContent = 'Connecting…';
        emptyHint.style.display = 'block';
    }
    if (state === 'reconnecting') {
        emptyHint.style.display = 'none';
        reconnectText.textContent = `Connection dropped - reconnecting… (attempt ${detail.attempt})`;
        reconnectBanner.classList.add('visible');
        reconnectBanner.classList.remove('warn');
    }
    if (state === 'maybe-frozen') {
        // Heads-up only at this point - we don't touch the connection
        // yet. Staying connected (including while AFK) is still the
        // default; this just gives you a manual nudge in case you're
        // back and the screen genuinely looks stuck.
        reconnectText.textContent = 'No screen updates for a while - still connected, but you can nudge it.';
        reconnectBanner.classList.add('visible', 'warn');
    }
    if (state === 'freeze-auto-reconnect') {
        reconnectText.textContent = 'Still no screen updates - reconnecting automatically…';
        reconnectBanner.classList.add('visible', 'warn');
    }
    if (state === 'frame-fresh') {
        if (!reconnectBanner.classList.contains('visible') || sessionManager.isConnected()) {
            reconnectBanner.classList.remove('warn');
            if (sessionManager.isConnected()) reconnectBanner.classList.remove('visible');
        }
    }
    if (state === 'freeze-alerts-off') {
        reconnectBanner.classList.remove('visible', 'warn');
    }
    if (state === 'disconnected') {
        reconnectBanner.classList.remove('visible', 'warn');
        emptyHint.textContent = 'Disconnected.';
    }
}

reconnectNowBtn.addEventListener('click', () => sessionManager.reconnectNow());

// ---- Session dock ----
sidebarHome.addEventListener('click', () => {
    sessionManager.disconnect();
    showDashboard();
});

sidebarDisconnect.addEventListener('click', () => {
    sessionManager.disconnect();
    showDashboard();
});

sidebarScreenshot.addEventListener('click', () => {
    if (!sessionManager.isConnected()) return;
    sessionManager.screenshot({ download: true });
    shotFlash.classList.remove('flash');
    void shotFlash.offsetWidth; // restart the flash animation on repeat clicks
    shotFlash.classList.add('flash');
});

sidebarFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        // Fullscreen the whole session body, not just the canvas stage -
        // the dock (disconnect, screenshot, etc.) lives inside it too, so
        // those controls stay visible and clickable in fullscreen instead
        // of being stranded outside the fullscreen element.
        sessionBody.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
});

// The "no screen updates" banner and its automatic-reconnect follow-up
// (see session.js) are both gated by this one switch - off means
// neither ever fires, if you'd rather it just stay quiet.
function syncFreezeAlertsButton() {
    const on = sessionManager.getFreezeAlertsEnabled();
    // Highlighted when *off*, like a muted-mic indicator - the default
    // (on) state should look like every other dock button; only the
    // "you turned something off" state needs to stand out.
    sidebarFreezeAlerts.classList.toggle('dock-btn-active', !on);
    sidebarFreezeAlerts.dataset.label = `Freeze alerts: ${on ? 'on' : 'off'}`;
}
sidebarFreezeAlerts.addEventListener('click', () => {
    sessionManager.setFreezeAlertsEnabled(!sessionManager.getFreezeAlertsEnabled());
    syncFreezeAlertsButton();
});
syncFreezeAlertsButton();

// ---- Logs drawer ----
function openLogs() {
    logsPanel.classList.add('open');
    logsBackdrop.classList.add('visible');
}
function closeLogs() {
    logsPanel.classList.remove('open');
    logsBackdrop.classList.remove('visible');
}
sidebarLogs.addEventListener('click', () => {
    logsPanel.classList.contains('open') ? closeLogs() : openLogs();
});
logsClose.addEventListener('click', closeLogs);
logsBackdrop.addEventListener('click', closeLogs);
logsCopy.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(asText());
        const icon = logsCopy.querySelector('i');
        icon.className = 'iconoir-check';
        setTimeout(() => { icon.className = 'iconoir-copy'; }, 1200);
    } catch (e) {
        log(`Couldn't copy to clipboard: ${formatError(e)}`, 'error');
    }
});
logsClear.addEventListener('click', clear);

// ---- Boot ----
log('Ready.');
showDashboard();
revealIn(dashNavbarPill);

// Boot splash: the logo starts huge/blurred (see the CSS default state on
// #boot-splash img) and everything below just plays it forward - sharpen
// in, hold for a beat, fade the whole overlay out. The dashboard behind
// it is already rendering the whole time, so by the time this fades
// there's something ready to land on.
requestAnimationFrame(() => {
    requestAnimationFrame(() => bootSplash.classList.add('sharp'));
});
setTimeout(() => {
    bootSplash.classList.add('fade-out');
    setTimeout(() => bootSplash.remove(), 650);
}, 1500);

// If exactly one saved connection is flagged auto-connect (the flash-icon
// toggle on its card), jump straight into it instead of waiting for a
// click - useful if this is basically always the same one machine.
// Dashboard still renders first so there's something to look at/cancel
// into if the auto-connect attempt fails.
api.list().then((connections) => {
    const autoConn = connections.find((c) => c.autoConnect);
    if (autoConn) {
        log(`Auto-connecting to "${autoConn.name}"…`);
        connectToSaved(autoConn);
    }
}).catch(() => { /* dashboard.refresh() already surfaces load errors */ });
