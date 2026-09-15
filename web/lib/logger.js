export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Timestamped session logger. Keeps every entry in memory (as plain text
// too) so the whole log can be copied to the clipboard in one click,
// independent of whatever is currently rendered in the panel.
export function createLogger(logEl, statusEl, statusDotEl) {
    const entries = [];

    function pad(n) { return String(n).padStart(2, '0'); }

    function timestamp() {
        const d = new Date();
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }

    function log(message, type = 'info') {
        const time = timestamp();
        entries.push({ time, type, message });

        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        entry.innerHTML = `<span class="log-time">${time}</span><span class="log-dot"></span><span class="log-msg">${escapeHtml(message)}</span>`;
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;

        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    function clear() {
        entries.length = 0;
        logEl.innerHTML = '';
    }

    function asText() {
        return entries.map(e => `[${e.time}] ${e.type.toUpperCase().padEnd(7)} ${e.message}`).join('\n');
    }

    function setStatus(text, state) {
        if (statusEl) statusEl.textContent = text;
        if (statusDotEl) statusDotEl.className = `status-dot status-${state}`;
    }

    function formatError(e) {
        if (e && typeof e === 'object' && '__wbg_ptr' in e) {
            try {
                const kindNames = {
                    0: 'General', 1: 'WrongPassword', 2: 'LogonFailure',
                    3: 'AccessDenied', 4: 'RDCleanPath', 5: 'ProxyConnect',
                    6: 'NegotiationFailure',
                };
                const kind = e.kind ? e.kind() : 'Unknown';
                const bt = e.backtrace ? e.backtrace() : '';
                return `[${kindNames[kind] || kind}] ${bt}`;
            } catch (_) {}
        }
        return e?.message || e?.toString() || String(e);
    }

    return { log, clear, asText, setStatus, formatError, entries };
}
