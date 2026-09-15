import { setupClipboard } from './clipboard.js';
import { setupInputHandlers } from './input.js';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000; // backoff still ramps up, but tops out here
const FREEZE_CHECK_INTERVAL_MS = 4000;
const FREEZE_STALE_CHECKS = 5; // ~20s of an unchanged frame before we say something
const FREEZE_AUTO_RECONNECT_CHECKS = FREEZE_STALE_CHECKS * 3; // ~60s before we act on it ourselves
const FREEZE_ALERTS_STORAGE_KEY = 'webrdp.freezeAlerts';

function freezeAlertsEnabled() {
    return localStorage.getItem(FREEZE_ALERTS_STORAGE_KEY) !== 'off'; // on by default
}

// Deliberately no file-transfer wiring here - this build only does the
// screen + keyboard/mouse + clipboard, on purpose.
//
// This version adds two things the original didn't have:
//  1. Auto-reconnect (with backoff) when the session ends unexpectedly
//     instead of the user clicking Disconnect - this is what used to show
//     up as "it just disconnects sometimes". Reconnection is persistent
//     and unbounded: it never gives up and drops back to "disconnected"
//     on its own (no attempt cap) - it just keeps retrying, with the
//     delay between attempts capped at RECONNECT_MAX_DELAY_MS so it
//     doesn't back off forever. The only way the session actually ends
//     is the user clicking Disconnect. This matters for staying
//     connected to a remote desktop while AFK - a network blip shouldn't
//     be the thing that quietly kicks you out.
//  2. A freeze watchdog that samples the canvas and surfaces a manual
//     "reconnect now" prompt if nothing has been drawn for a while, so a
//     hung session doesn't just sit there looking connected forever. If
//     it's still frozen ~60s later, it goes further and reconnects on
//     its own rather than just leaving a banner up indefinitely - a
//     stuck session isn't something staying "persistently connected"
//     helps with, since it's not actually delivering anything. All of
//     this - the banner AND the auto-reconnect - is one toggle
//     (setFreezeAlertsEnabled / getFreezeAlertsEnabled, on by default,
//     persisted in localStorage) in case you'd rather it never chime in.
export function createSessionManager({
    canvas,
    SessionBuilder, DesktopSize, Extension, DeviceEvent, InputTransaction, ClipboardData,
    init, setup, log, setStatus, formatError,
    onStateChange = () => {},
    onScreenshot = () => {},
}) {
    let session = null;
    let clipboardReady = false;
    let wasmReady = false;
    let userDisconnected = false;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let currentParams = null;
    let inputHandlersBound = false;

    let freezeTimer = null;
    let lastFrameSample = null;
    let staleChecks = 0;

    const offscreen = document.createElement('canvas');
    offscreen.width = 32;
    offscreen.height = 18;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    function normalizeDestination(raw) {
        const value = (raw || '').trim();
        if (!value) return '127.0.0.1:3389';
        if (value.includes(':')) return value;
        return `${value}:3389`;
    }

    function getSession() {
        return session;
    }

    async function ensureWasm() {
        if (wasmReady) return;
        await init();
        setup('info');
        wasmReady = true;
        log('WASM module initialized', 'success');
    }

    // params: { destination, username, password }
    async function connect(params, { isReconnect = false } = {}) {
        currentParams = params;
        userDisconnected = false;
        if (!isReconnect) reconnectAttempt = 0;

        try {
            await ensureWasm();

            const destination = normalizeDestination(params.destination);
            setStatus(isReconnect ? `Reconnecting… (attempt ${reconnectAttempt})` : 'Connecting…', 'connecting');
            onStateChange(isReconnect ? 'reconnecting' : 'connecting', { attempt: reconnectAttempt });

            log(`Connecting to ${destination}${isReconnect ? ` (reconnect attempt ${reconnectAttempt})` : ''}`);
            log(`User: ${params.username}`);

            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const proxyAddress = `${wsProtocol}//${location.host}`;

            const desktopSize = new DesktopSize(1280, 720);
            const enableCredsspExt = new Extension('enable_credssp', true);

            const builder = new SessionBuilder();
            builder.username(params.username);
            builder.password(params.password);
            builder.destination(destination);
            builder.proxyAddress(proxyAddress);
            builder.authToken('none');
            builder.desktopSize(desktopSize);
            builder.renderCanvas(canvas);
            builder.extension(enableCredsspExt);

            setupClipboard(builder, { ClipboardData, log, formatError }, {
                session: () => session,
                clipboardReady: () => clipboardReady,
                setClipboardReady: (v) => { clipboardReady = v; },
            });

            builder.setCursorStyleCallbackContext(canvas);
            builder.setCursorStyleCallback(function (style) {
                canvas.style.cursor = style || 'default';
            });

            log('Initiating RDP connection…');
            const newSession = await builder.connect();
            session = newSession;

            const ds = session.desktopSize();
            log(`Connected! Desktop: ${ds.width}x${ds.height}`, 'success');
            canvas.width = ds.width;
            canvas.height = ds.height;

            setStatus(`Connected (${ds.width}×${ds.height})`, 'connected');
            onStateChange('connected', {});
            canvas.focus();
            reconnectAttempt = 0;

            if (!inputHandlersBound) {
                // Bound once, ever - it reads the current `session` through
                // getSession() each time, so it keeps working across
                // reconnects without re-registering listeners.
                setupInputHandlers(canvas, getSession, { DeviceEvent, InputTransaction }, log);
                inputHandlersBound = true;
            }

            startFreezeWatchdog();

            session.run().then((info) => {
                log(`Session ended: ${info.reason()}`, 'warn');
                handleSessionEnd();
            }).catch((e) => {
                log(`Session error: ${formatError(e)}`, 'error');
                handleSessionEnd();
            });

        } catch (e) {
            log(`Connection failed: ${formatError(e)}`, 'error');
            handleSessionEnd();
            throw e;
        }
    }

    function handleSessionEnd() {
        stopFreezeWatchdog();
        session = null;
        clipboardReady = false;

        if (userDisconnected || !currentParams) {
            setStatus('Disconnected', 'disconnected');
            onStateChange('disconnected', {});
            return;
        }

        reconnectAttempt += 1;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempt - 1), RECONNECT_MAX_DELAY_MS);
        setStatus(`Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectAttempt})`, 'connecting');
        onStateChange('reconnecting', { attempt: reconnectAttempt, delay });

        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            connect(currentParams, { isReconnect: true }).catch(() => { /* handleSessionEnd already logged it */ });
        }, delay);
    }

    function reconnectNow() {
        clearTimeout(reconnectTimer);
        if (!currentParams) return;
        connect(currentParams, { isReconnect: true }).catch(() => {});
    }

    function disconnect() {
        userDisconnected = true;
        clearTimeout(reconnectTimer);
        stopFreezeWatchdog();
        captureScreenshot();
        if (session) {
            try {
                session.shutdown();
                log('Disconnected by user', 'warn');
            } catch (e) {
                log(`Disconnect error: ${formatError(e)}`, 'error');
            }
        }
        session = null;
        clipboardReady = false;
        currentParams = null;
        setStatus('Disconnected', 'disconnected');
        onStateChange('disconnected', {});
    }

    // ---- Freeze watchdog ----
    // We can't see inside the WASM engine's transport, so this is a
    // heuristic: if the canvas hasn't visibly changed in ~20s while we
    // still think we're connected, something's probably stuck. We first
    // just *suggest* a reconnect rather than forcing one, since a
    // genuinely idle remote desktop looks identical to a frozen one from
    // here - but if it's still frozen ~60s in, we go ahead and reconnect
    // for real, since at that point "maybe idle" has stopped being a
    // reasonable read. The whole thing can be switched off (see
    // setFreezeAlertsEnabled) if you'd rather it stay quiet.
    function startFreezeWatchdog() {
        stopFreezeWatchdog();
        lastFrameSample = null;
        staleChecks = 0;
        freezeTimer = setInterval(() => {
            if (!session || !freezeAlertsEnabled()) return;
            try {
                offCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
                const sample = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data.toString();
                if (sample === lastFrameSample) {
                    staleChecks += 1;
                } else {
                    staleChecks = 0;
                    lastFrameSample = sample;
                    onStateChange('frame-fresh', {});
                }
                if (staleChecks === FREEZE_STALE_CHECKS) {
                    onStateChange('maybe-frozen', {});
                } else if (staleChecks === FREEZE_AUTO_RECONNECT_CHECKS) {
                    log('No screen updates for a while - reconnecting automatically.', 'warn');
                    onStateChange('freeze-auto-reconnect', {});
                    reconnectNow();
                }
            } catch (_) {
                // Canvas may be tainted/unreadable in some browsers - skip silently.
            }
        }, FREEZE_CHECK_INTERVAL_MS);
    }

    function stopFreezeWatchdog() {
        clearInterval(freezeTimer);
        freezeTimer = null;
    }

    function captureScreenshot() {
        if (!currentParams?.connectionId || canvas.width === 0) return;
        try {
            const thumb = document.createElement('canvas');
            thumb.width = 320;
            thumb.height = Math.round(320 * (canvas.height / canvas.width));
            thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
            onScreenshot(currentParams.connectionId, thumb.toDataURL('image/jpeg', 0.6));
        } catch (_) {
            // Best-effort only - never let a thumbnail failure block disconnect.
        }
    }

    function isConnected() {
        return !!session;
    }

    function getFreezeAlertsEnabled() {
        return freezeAlertsEnabled();
    }

    function setFreezeAlertsEnabled(enabled) {
        localStorage.setItem(FREEZE_ALERTS_STORAGE_KEY, enabled ? 'on' : 'off');
        staleChecks = 0;
        if (!enabled) onStateChange('freeze-alerts-off', {});
    }

    // Manual, user-triggered screenshot - full resolution, downloaded as a
    // PNG. Also piggy-backs on captureScreenshot() so the dashboard thumb
    // for this connection gets refreshed at the same time.
    function screenshot({ download = false } = {}) {
        if (!session || !canvas.width || !canvas.height) return null;
        let dataUrl;
        try {
            dataUrl = canvas.toDataURL('image/png');
        } catch (e) {
            log(`Screenshot failed: ${formatError(e)}`, 'error');
            return null;
        }
        if (download) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `webrdp-${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            log('Screenshot saved', 'success');
        }
        captureScreenshot();
        return dataUrl;
    }

    return { connect, disconnect, reconnectNow, isConnected, getSession, screenshot, getFreezeAlertsEnabled, setFreezeAlertsEnabled };
}
