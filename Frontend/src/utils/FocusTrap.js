import { useEffect, useRef } from 'react';

// Lightweight focus trap that targets an existing DOM container by selector.
// When active it:
// - focuses the first focusable element inside the container
// - traps Tab/Shift+Tab inside the container
// - sets aria-hidden on other direct children of <body> to improve screen-reader behavior
export default function FocusTrap({ active, containerSelector }) {
  const prevFocused = useRef(null);
  const hiddenNodes = useRef([]);

  useEffect(() => {
    if (!active) return undefined;
    try {
      prevFocused.current = document.activeElement;
      const container = document.querySelector(containerSelector);
      if (!container) return undefined;

      // mark other body children as aria-hidden (but not overlays or the container itself)
      const children = Array.from(document.body.children || []);
      hiddenNodes.current = [];
      children.forEach((c) => {
        if (c === container) return;
        // allow overlays shared by drawers/bottom-sheets (class overlay or modal-backdrop)
        if (c.classList && (c.classList.contains('overlay') || c.classList.contains('modal-backdrop') || c.classList.contains('bottom-sheet'))) return;
        try {
          if (!c.hasAttribute('aria-hidden')) {
            c.setAttribute('aria-hidden', 'true');
            hiddenNodes.current.push(c);
          }
        } catch (e) {}
      });

      // focus first focusable element inside container, or container itself
      const focusable = container.querySelectorAll("a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])");
      const first = focusable && focusable.length ? focusable[0] : null;
      try {
        (first || container).focus();
      } catch (e) {}

      function onKey(e) {
        if (e.key !== 'Tab') return;
        const focusableEls = Array.from(container.querySelectorAll("a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])")).filter(Boolean);
        if (!focusableEls.length) {
          e.preventDefault();
          return;
        }
        const firstEl = focusableEls[0];
        const lastEl = focusableEls[focusableEls.length - 1];
        if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          (firstEl).focus();
        } else if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          (lastEl).focus();
        }
      }

      document.addEventListener('keydown', onKey);

      return () => {
        document.removeEventListener('keydown', onKey);
        // restore aria-hidden
        try {
          hiddenNodes.current.forEach((n) => n.removeAttribute('aria-hidden'));
        } catch (e) {}
        // restore focus
        try { prevFocused.current && prevFocused.current.focus(); } catch (e) {}
      };
    } catch (e) {
      return undefined;
    }
  }, [active, containerSelector]);

  return null;
}
