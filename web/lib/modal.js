import { revealIn } from './reveal.js';

// Wireframe 2: the "add new connection" overlay. Handles opening/closing
// and validating the form, then hands a plain {name, host, username,
// password, save} object back to whoever asked for it (app.js).
export function createConnectionModal({ overlayEl, formEl, cancelBtn, errorEl }) {
    const nameInput = document.getElementById('conn-name');
    const hostInput = document.getElementById('conn-host');
    const usernameInput = document.getElementById('conn-username');
    const passwordInput = document.getElementById('conn-password');
    const saveCheckbox = document.getElementById('conn-save');

    let resolvePromise = null;

    function open() {
        errorEl.textContent = '';
        formEl.reset();
        saveCheckbox.checked = true;
        overlayEl.classList.add('open');
        formEl.classList.remove('reveal-in');
        revealIn(formEl);
        setTimeout(() => hostInput.focus(), 50);
        return new Promise((resolve) => { resolvePromise = resolve; });
    }

    function close(result = null) {
        overlayEl.classList.remove('open');
        if (resolvePromise) {
            resolvePromise(result);
            resolvePromise = null;
        }
    }

    formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const host = hostInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!host) { errorEl.textContent = 'Enter a server address.'; hostInput.focus(); return; }
        if (!username) { errorEl.textContent = 'Enter a username.'; usernameInput.focus(); return; }

        close({
            name: nameInput.value.trim() || host,
            host,
            username,
            password,
            save: saveCheckbox.checked,
        });
    });

    cancelBtn.addEventListener('click', () => close(null));
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) close(null);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlayEl.classList.contains('open')) close(null);
    });

    return { open };
}
