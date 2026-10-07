import type { StrokeStore } from './StrokeStore';
import type { Stroke } from './types';

/**
 * Every edit on the page is expressed as "remove these strokes, add those".
 * Drawing, both erasers, scratch-out and clear all reduce to this single
 * reversible command, so undo/redo is uniform and cannot drift.
 */
export interface EditCommand {
  readonly label: 'draw' | 'erase' | 'pixel-erase' | 'scratch' | 'clear';
  readonly added: readonly Stroke[];
  readonly removed: readonly Stroke[];
}

export const DEFAULT_HISTORY_LIMIT = 300;

export class History {
  private undoStack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: StrokeStore,
    private readonly limit = DEFAULT_HISTORY_LIMIT,
  ) {}

  /** Apply a new command to the store and record it. */
  execute(cmd: EditCommand): void {
    if (cmd.added.length === 0 && cmd.removed.length === 0) return;
    this.store.apply(cmd.added, cmd.removed);
    this.record(cmd);
  }

  /**
   * Record a command whose effect has already been applied to the store
   * (live erasing updates the page while the pointer moves).
   */
  record(cmd: EditCommand): void {
    if (cmd.added.length === 0 && cmd.removed.length === 0) return;
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    // Dropping the redo branch releases references to orphaned strokes.
    this.redoStack = [];
    this.emit();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    this.store.apply(cmd.removed, cmd.added);
    this.redoStack.push(cmd);
    this.emit();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    this.store.apply(cmd.added, cmd.removed);
    this.undoStack.push(cmd);
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
