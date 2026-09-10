export async function installDevShell(): Promise<void> {
  if (!import.meta.env.DEV) return
  Object.assign(document.documentElement.dataset, {
    neurodeskApp: 'browserqc', neurodeskShell: 'imaging-workspace', neurodeskTheme: 'dark',
  })
  const metadata = document.createElement('script')
  Object.assign(metadata.dataset, {
    neurodeskAppShell: '', appId: 'browserqc', appShell: 'imaging-workspace',
    appTitle: 'BrowserQC', appDescription: 'Automated browser-native MRI segmentation and image-quality metrics.',
    appVersion: '0.1.20260909', ga4MeasurementId: 'G-4Z9774J59Y',
    analyticsHref: 'data:text/javascript,export function initAnalytics(){return Object.freeze({enabled:false})}',
    moreAppsHref: '/', sourceHref: 'https://github.com/neurodesk/webapps/tree/main/apps/browserqc',
  })
  document.head.append(metadata)
  await import('../../../site/app-theme.css')
  // @ts-expect-error theme.js is an intentional classic-script side-effect module.
  await import('../../../site/theme.js')
  await import('../../../site/app-shell.js')
}
