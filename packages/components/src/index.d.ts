export type ShellControlAction = 'about' | 'cite' | 'privacy' | 'standalone';
export type ShellTarget = string | Element;
export type ShellTargetSet = ShellTarget | readonly ShellTarget[];
export type ShellControlsContract = Partial<Record<ShellControlAction, ShellTargetSet>>;

export interface ImagingWorkspaceConfig {
  document?: Document;
  root?: string | Element;
  controls: string | Element;
  viewer: string | Element;
  status: string | Element;
  title?: string;
  subtitle?: string;
  mark?: string;
  moreAppsHref?: string;
  controlsContract?: ShellControlsContract;
}

export function mountImagingWorkspace(config: ImagingWorkspaceConfig): HTMLElement;

// ---- Workflow vocabulary builders (ui) ----
export interface RenderedFileField {
  root: HTMLLabelElement;
  input: HTMLInputElement;
  text: HTMLElement;
  onFiles(handler: (files: Promise<File[]>) => void): RenderedFileField;
  setText(value: string): void;
  setHasFiles(value: boolean): void;
}
export function renderFileField(config?: {
  id?: string; name?: string; text?: string; html?: string; label?: string;
  kind?: 'image' | 'model' | 'surface' | 'protocol' | 'gradients' | 'metadata' | 'dataset';
  multiple?: boolean; accept?: string; directory?: boolean; rootId?: string;
}, doc?: Document): RenderedFileField;
export function bindFileDrop(target: Element, handler: ((files: Promise<File[]>) => void) | null, doc?: Document): { handler: ((files: Promise<File[]>) => void) | null };

export interface RenderedConsole {
  root: HTMLDivElement;
  output: HTMLDivElement;
  console: import('./ui/ConsoleOutput.js').ConsoleOutput;
  open(): void;
  close(): void;
  log(message: unknown, level?: 'info' | 'success' | 'warning' | 'error'): void;
}
export function renderConsole(config?: {
  id?: string; outputId?: string; outputLabel?: string; title?: string; collapsed?: boolean;
  copy?: boolean; clear?: boolean; copyId?: string; clearId?: string; mirrorToConsole?: boolean; maxLines?: number; bind?: boolean;
}, doc?: Document): RenderedConsole;

export interface InfoDialog {
  root: HTMLDialogElement;
  title: HTMLHeadingElement;
  body: HTMLDivElement;
  open(heading: string, content?: string | Node | Node[] | null, options?: { wide?: boolean; classes?: Record<string, boolean> }): HTMLDialogElement;
  close(): void;
  setContent(content?: string | Node | Node[] | null): void;
}
export function createInfoDialog(config?: { id?: string; titleId?: string; bodyId?: string; parent?: Element }, doc?: Document): InfoDialog;
export function renderCommand(config: { id?: string; command: string; label?: string; onCopy?(copied: boolean, command: string): void }, doc?: Document): { root: HTMLDivElement; code: HTMLElement; button: HTMLButtonElement };

export function bindInfoTooltips(root?: ParentNode): void;
export function renderInfoIcon(text: string, config?: { label?: string; id?: string }, doc?: Document): HTMLSpanElement;
export function bindSectionDisclosure(section: Element, root?: ParentNode): MutationObserver;
