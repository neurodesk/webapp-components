/** Use the production shell modules during Vite development, too. */
export async function installDevShell(): Promise<void> {
  if (!import.meta.env.DEV) return

  document.documentElement.dataset.neurodeskApp = 'dwi2trx'
  document.documentElement.dataset.neurodeskShell = 'imaging-workspace'
  document.documentElement.dataset.neurodeskTheme = 'dark'
  const metadata = document.createElement('script')
  metadata.dataset.neurodeskAppShell = ''
  metadata.dataset.appId = 'dwi2trx'
  metadata.dataset.appShell = 'imaging-workspace'
  metadata.dataset.appTitle = 'dwi2trx'
  metadata.dataset.appDescription = 'Browser-native diffusion tensor fitting and GPU streamline tractography.'
  metadata.dataset.appVersion = '0.1.20260909'
  metadata.dataset.ga4MeasurementId = 'G-4Z9774J59Y'
  metadata.dataset.analyticsHref = 'data:text/javascript,export function initAnalytics(){return Object.freeze({enabled:false,reason:"development"})}'
  metadata.dataset.moreAppsHref = '/'
  metadata.dataset.sourceHref = 'https://github.com/neurodesk/webapps/tree/main/apps/dwi2trx'
  document.head.append(metadata)
  await import('../../../site/app-theme.css')
  await import('../../../site/theme.js')
  await import('../../../site/app-shell.js')
}
