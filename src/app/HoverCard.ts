import { confidenceLevel, type Projection } from '../canvas/AnswerLayer';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Explains an answer: what was read, exactness, and per-symbol confidence. */
export class HoverCard {
  private shownKey: string | null = null;

  constructor(private readonly el: HTMLElement) {}

  show(p: Projection, clientX: number, clientY: number, latencyMs: number | null): void {
    const line = p.line;
    const a = line.answer!;
    if (this.shownKey !== `${p.key}|${line.text}|${a.text}`) {
      this.shownKey = `${p.key}|${line.text}|${a.text}`;
      const pretty = line.text.replace(/([+−×÷=])/g, ' $1 ');
      const pct = Math.round(line.confidence * 100);
      const level = confidenceLevel(line.confidence);
      const barColor = level === 'high' ? 'var(--ok)' : level === 'medium' ? 'var(--warn)' : 'var(--bad)';
      const status =
        a.status === 'value'
          ? a.exact
            ? 'Exact'
            : `Rounded${a.fraction ? ` · exact ${esc(a.fraction)}` : ''}`
          : a.status === 'correct'
            ? '✓ Your answer is correct'
            : a.status === 'incorrect'
              ? `✗ Expected ${esc(a.text)}`
              : esc(a.message ?? a.text);
      const shownAnswer = a.status === 'value' ? ` <span class="hc-ans">${esc(a.text)}</span>` : '';
      const chips = line.symbols
        .map(
          (s) =>
            `<span class="hc-chip ${confidenceLevel(s.confidence)}" title="${s.source === 'geometry' ? 'stroke geometry' : 'neural model'}"><b>${esc(s.char)}</b>${Math.round(s.confidence * 100)}%</span>`,
        )
        .join('');
      this.el.innerHTML = `
        <div class="hc-expr">${esc(pretty)}${shownAnswer}</div>
        <div class="hc-row"><span>${status}</span></div>
        <div class="hc-bar"><i style="width:${pct}%;background:${barColor}"></i></div>
        <div class="hc-row"><span>Recognition confidence</span><b>${pct}%</b></div>
        ${latencyMs !== null ? `<div class="hc-row"><span>On-device latency</span><b>${latencyMs.toFixed(1)} ms</b></div>` : ''}
        <div class="hc-chips">${chips}</div>`;
    }
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - r.width - 12, Math.max(12, clientX + 16));
    const y = clientY + r.height + 28 > window.innerHeight ? clientY - r.height - 16 : clientY + 20;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  hide(): void {
    this.el.hidden = true;
    this.shownKey = null;
  }
}
