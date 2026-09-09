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
