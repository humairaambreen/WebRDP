import { api } from './api.js';
import { revealStagger } from './reveal.js';

// Renders the "saved connections + add new" grid from wireframe 1, and
// wires up card clicks (connect) and the small delete affordance.
export function createDashboard({ gridEl, onConnect, onAddNew, onCountChange = () => {} }) {
    let connections = [];
    let loadError = null;

    function timeAgo(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        const mins = Math.round(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

    function render() {
        gridEl.innerHTML = '';

        if (loadError) {
            const banner = document.createElement('div');
            banner.className = 'dash-error';
            banner.innerHTML = `<i class="iconoir-warning-triangle"></i> Couldn't load saved connections (${escapeHtml(loadError)}). You can still start a new one below.`;
            gridEl.appendChild(banner);
        }

        connections.forEach((conn) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'conn-card';
            card.dataset.id = conn.id;

            // A screenshot gets a full-bleed image with a progressive
            // blur ramping in toward the bottom (three stacked copies of
            // the same image, each blurred more and masked to a lower
            // band) so the credentials sit in a soft frosted strip
            // instead of a separate flat panel. No screenshot yet -> just
            // the placeholder mark, no blur layers needed.
            const preview = conn.lastScreenshot
                ? `
                    <div class="conn-preview" style="--preview-img:url('${conn.lastScreenshot}')">
                        <div class="conn-preview-layer conn-preview-base"></div>
                        <div class="conn-preview-layer conn-preview-blur-1"></div>
                        <div class="conn-preview-layer conn-preview-blur-2"></div>
                        <div class="conn-preview-scrim"></div>
                    </div>
                `
                : `
                    <div class="conn-preview">
                        <div class="conn-preview-placeholder"><img src="assets/logo-96.png" alt=""></div>
                        <div class="conn-preview-scrim"></div>
                    </div>
                `;

            card.innerHTML = `
                ${preview}
                <div class="conn-preview-info">
                    <span class="conn-name">${escapeHtml(conn.name)}</span>
                    <span class="conn-meta">${escapeHtml(conn.host)} · ${escapeHtml(conn.username)}</span>
                    <span class="conn-meta conn-meta-muted">
                        ${timeAgo(conn.updatedAt)}${conn.autoConnect ? ' · <span class="conn-autoconnect-badge">Auto-connects on launch</span>' : ''}
                    </span>
                </div>
                <button type="button" class="conn-autoconnect${conn.autoConnect ? ' active' : ''}"
                        title="${conn.autoConnect ? 'Auto-connect on launch (on) - click to turn off' : 'Auto-connect on launch (off) - click to turn on'}"
                        data-id="${conn.id}">
                    <i class="iconoir-flash"></i>
                </button>
                <button type="button" class="conn-delete" title="Remove" data-id="${conn.id}">
                    <i class="iconoir-trash"></i>
                </button>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.conn-delete') || e.target.closest('.conn-autoconnect')) return;
                onConnect(conn);
            });

            card.querySelector('.conn-delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm(`Remove "${conn.name}"?`)) return;
                await api.remove(conn.id);
                await refresh();
            });

            card.querySelector('.conn-autoconnect').addEventListener('click', async (e) => {
                e.stopPropagation();
                await api.setAutoConnect(conn.id, !conn.autoConnect);
                await refresh();
            });

            gridEl.appendChild(card);
        });

        const addCard = document.createElement('button');
        addCard.type = 'button';
        addCard.className = 'conn-card conn-card-add';
        addCard.innerHTML = `<i class="iconoir-plus"></i><span>Add a new connection</span>`;
        addCard.addEventListener('click', onAddNew);
        gridEl.appendChild(addCard);

        revealStagger(gridEl.children, { stagger: 45 });
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function refresh() {
        try {
            connections = await api.list();
            loadError = null;
        } catch (e) {
            connections = [];
            loadError = e.message || 'unknown error';
        }
        render();
        onCountChange(connections.length);
    }

    return { refresh };
}
