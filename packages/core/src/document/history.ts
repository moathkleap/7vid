import type { Patch } from 'immer';
import { applyDocumentPatches, applyCommand, type Command, type CommandResult } from './commands';
import type { ProjectDocument } from './types';

export interface HistoryEntry {
  id: number;
  label: string;
  command: Command;
  patches: Patch[];
  inversePatches: Patch[];
  at: string;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  size: number;
}

/**
 * Undo/redo stack based on immer patches. The document itself is immutable; every entry stores the
 * forward and inverse patches so undo/redo are O(patch) instead of O(document).
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private seq = 0;

  constructor(private readonly limit = 500) {}

  /** Applies a command to the document, records it, and returns the new document. */
  execute(doc: ProjectDocument, cmd: Command): { doc: ProjectDocument; result: CommandResult; entry: HistoryEntry | null } {
    const result = applyCommand(doc, cmd);
    if (!result.changed) return { doc, result, entry: null };
    const entry: HistoryEntry = {
      id: ++this.seq,
      label: result.label,
      command: cmd,
      patches: result.patches,
      inversePatches: result.inversePatches,
      at: new Date().toISOString(),
    };
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return { doc: result.doc, result, entry };
  }

  undo(doc: ProjectDocument): { doc: ProjectDocument; entry: HistoryEntry } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { doc: applyDocumentPatches(doc, entry.inversePatches), entry };
  }

  redo(doc: ProjectDocument): { doc: ProjectDocument; entry: HistoryEntry } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { doc: applyDocumentPatches(doc, entry.patches), entry };
  }

  state(): HistoryState {
    const undoTop = this.undoStack[this.undoStack.length - 1];
    const redoTop = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
      size: this.undoStack.length,
    };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
