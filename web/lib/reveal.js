// Tiny in-house "blur reveal" animator - the effect people usually reach
// GSAP for (elements resolve in from a soft blur + slight drift instead of
// just popping into place), built on nothing but rAF + CSS. No dependency.
//
// Usage:
//   revealIn(el)                     - animate a single element in
//   revealIn(el, { delay: 80 })      - with a stagger offset
//   revealStagger([el1, el2, ...])   - animate a list, each one a little
//                                      later than the last
//
// The element just needs `.reveal` in its class list (see style.css for
// the two CSS states, .reveal and .reveal-in) - this module only ever
// toggles that second class at the right time.
const DEFAULT_STAGGER_MS = 55;

export function revealIn(el, { delay = 0 } = {}) {
    if (!el) return;
    el.classList.add('reveal');
    // Force layout so the browser commits the "before" state before we
    // flip to "after" - otherwise the very first reveal on a freshly
    // inserted node can get coalesced into one frame and never animate.
    void el.offsetWidth;
    window.setTimeout(() => {
        requestAnimationFrame(() => el.classList.add('reveal-in'));
    }, delay);
}

export function revealStagger(els, { stagger = DEFAULT_STAGGER_MS, startDelay = 0 } = {}) {
    Array.from(els).forEach((el, i) => revealIn(el, { delay: startDelay + i * stagger }));
}
