import type { AnswerStatus } from '../recognition/types';

/**
 * Micro-feedback: tiny synthesised sounds (no audio assets, works offline)
 * and haptic taps on devices that support the Vibration API.
 */
export class Feedback {
  private ctx: AudioContext | null = null;
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Must be called from a user gesture (pointerdown) to satisfy autoplay policies. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  /** Short paper-scratch noise burst. */
  private scratch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.16);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }

  private vibrate(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }

  answer(status: AnswerStatus): void {
    if (!this.enabled) return;
    switch (status) {
      case 'value':
        this.tone(1046.5, 0, 0.16, 0.035);
        this.tone(1568, 0.05, 0.22, 0.025);
        this.vibrate(8);
        break;
      case 'correct':
        this.tone(784, 0, 0.14, 0.04);
        this.tone(1175, 0.08, 0.26, 0.035);
        this.vibrate([8, 50, 8]);
        break;
      case 'incorrect':
      case 'undefined':
        this.tone(330, 0, 0.2, 0.04, 'triangle');
        this.tone(262, 0.09, 0.26, 0.035, 'triangle');
        this.vibrate(20);
        break;
      default:
        this.tone(440, 0, 0.12, 0.02, 'triangle');
    }
  }

  erased(): void {
    if (!this.enabled) return;
    this.scratch();
    this.vibrate([6, 30, 6]);
  }
}
