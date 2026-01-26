Accessibility & Mobile QA Report
===============================

Tested widths (visual + keyboard checks):

- 360px (small phone)
  - Notes: Drawer opens full-height (80% width), close button inside drawer visible and reachable by Tab.
  - Issues / Suggestions: Thread tiles are compact; increase left/right padding on `.thread-btn` by ~6px to improve tap target.

- 375px (iPhone 11/12/13 Mini)
  - Notes: Bottom sheet slides up correctly; sheet close button is visible and receives focus.
  - Issues / Suggestions: Bottom-sheet padding is comfortable; consider increasing `.bottom-sheet .sheet-close` hit area (add 8px padding) for easier touch.

- 412px (many Android devices)
  - Notes: Chat input remains fixed at bottom and does not overlap controls; FocusTrap ensures keyboard Tab cycles inside drawer/sheet.
  - Issues / Suggestions: Chat message area height can be slightly increased by 24px to reduce scroll jumps when keyboard opens.

- 768px (tablet)
  - Notes: Layout switches to stacked blocks; left panel is visible on the left in wider split view. Focus trap only applies when mobile sheet/drawer are open.
  - Issues / Suggestions: None critical; spacing around action buttons may be restored to desktop sizes.

Accessibility checks performed:

- Focus trap: when drawer or bottom-sheet opens, keyboard Tab/Shift+Tab cycles only within that container. Previous focus is restored after close.
- Aria-hidden: non-modal content is set to `aria-hidden="true"` while the modal/drawer is open so screen readers ignore background content.
- Close buttons: both a floating drawer close button and an inner close button exist; the inner close button is reachable via keyboard and labeled `Close menu`.

Recommended small spacing tweaks (to implement):

- Increase `.thread-btn` padding from current values by 6px horizontally and 4px vertically on mobile to improve tap targets.
- Increase `.bottom-sheet .sheet-close` padding to 12px (from 6-8px) so the hit area is larger.
- Slightly raise `.chat-panel .messages` max-height on mobile (+24px) to reduce scroll triggering when keyboard shows.

How to test locally:

1. Start frontend (dev) server:

```bash
cd Frontend
npm install
npm start
```

2. In browser devtools, toggle device toolbar and test widths: 360, 375, 412, 768.
3. Test keyboard-only navigation:
   - Open drawer (menu button) then Tab to ensure focus lands in the drawer and cycles inside.
   - Open a summary bottom-sheet and verify Tab/Shift+Tab cycles inside sheet and that Escape (if desired) closes it (Escape handling not implemented yet).

4. Test screenreader behavior (NVDA/VoiceOver): open sheet/drawer and verify background content is not read (aria-hidden applied).

If you'd like, I can also implement the small spacing adjustments automatically.
