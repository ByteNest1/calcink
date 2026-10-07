/** Inline SVG icons (24×24, stroke-based; colour comes from currentColor). */
const svg = (body: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pen: svg('<path d="M4 20l1.2-4.6L16 4.6a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M14 7l3 3"/>'),
  strokeEraser: svg('<path d="M8.5 20H20"/><path d="M5.2 15.4l8.9-8.9a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8L13 18.2a2 2 0 0 1-1.4.6H9.1a2 2 0 0 1-1.4-.6l-2.5-2.5a2 2 0 0 1 0-2.8z"/><path d="M9.5 11l5 5"/>'),
  pixelEraser: svg('<circle cx="12" cy="12" r="7.5" stroke-dasharray="2.6 2.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  clear: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/>'),
  insight: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  soundOn: svg('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  perf: svg('<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>'),
  theme: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
} as const;
