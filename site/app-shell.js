import { resolveShellAdapter } from './shell-adapters/index.js';

(() => {
  const shellScript = document.querySelector('script[data-neurodesk-app-shell]');
  if (!shellScript) return;

  const metadata = {
    id: shellScript.dataset.appId,
    title: shellScript.dataset.appTitle,
    description: shellScript.dataset.appDescription,
    version: shellScript.dataset.appVersion,
    measurementId: shellScript.dataset.ga4MeasurementId,
    analyticsHref: shellScript.dataset.analyticsHref,
    moreAppsHref: shellScript.dataset.moreAppsHref,
    sourceHref: shellScript.dataset.sourceHref,
    shell: shellScript.dataset.appShell,
  };

  const analyticsUrl = new URL(metadata.analyticsHref, document.baseURI);
  import(/* @vite-ignore */ analyticsUrl.href)
    .then(({ initAnalytics }) => initAnalytics(metadata.measurementId))
    .catch((error) => console.warn('Neurodesk page-view analytics could not start:', error));

  const icons = {
    about: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
    cite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h12a2 2 0 0 1 2 2V21H7a2 2 0 0 1-2-2V3.5Z"/><path d="M7 17h12M9 7h6"/></svg>',
    privacy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s8-3.8 8-10V5l-8-3-8 3v6c0 6.2 8 10 8 10Z"/></svg>',
    standalone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>',
    theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    apps: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.84a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
  };

  function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text) node.textContent = options.text;
    if (options.title) node.title = options.title;
    if (options.href) node.href = options.href;
    if (options.html) node.innerHTML = options.html;
    return node;
  }

  function versionLabel(value) {
    const clean = String(value || '').trim();
    return clean.startsWith('v') ? clean : `v${clean}`;
  }

  function createAction(label, icon, onClick) {
    const button = element('button', {
      className: 'nd-app-bar__action',
      title: label,
      html: `${icons[icon]}<span>${label}</span>`,
    });
    button.type = 'button';
    if (onClick) button.addEventListener('click', onClick);
    return button;
  }

  function createControlAction(action, label, icon) {
    const button = createAction(label, icon, () => openAppInformation(action));
    button.dataset.neurodeskShellControl = action;
    return button;
  }

  function createLink(label, icon, href, title) {
    const link = element('a', {
      className: 'nd-app-bar__action',
      title,
      href,
      html: `${icons[icon]}<span>${label}</span>`,
    });
    if (/^https?:/i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    return link;
  }

  function findLegacyControl(action) {
    return document.querySelector(`[data-neurodesk-control="${action}"]`);
  }

  function openFallbackDialog(kind) {
    let dialog = document.querySelector(`.nd-app-dialog[data-dialog="${kind}"]`);
    if (!dialog) {
      dialog = element('dialog', { className: 'nd-app-dialog' });
      dialog.dataset.dialog = kind;
      const headings = { about: `About ${metadata.title}`, cite: `Cite ${metadata.title}`, privacy: 'Privacy' };
      const displayedVersion = document.querySelector('.nd-app-bar__version')?.textContent || versionLabel(metadata.version);
      const messages = {
        about: `${metadata.description} This page is running ${displayedVersion}.`,
        cite: `Please cite the scientific software, methods, and models used in your analysis. App-specific citation details are available in the documentation and source repository.`,
        privacy: `Imaging files are processed in your browser unless the app clearly states otherwise. The Neurodesk hosting layer records page views only and sends no custom events. It makes no analytics request when Do Not Track or Global Privacy Control is enabled, and never sends your loaded imaging data to Google Analytics.`,
      };
      const panel = element('div', { className: 'nd-app-dialog__panel' });
      const heading = element('h2', { text: headings[kind] });
      const copy = element('p', { text: messages[kind] });
      const source = createLink('View source on GitHub', 'github', metadata.sourceHref, 'View source on GitHub');
      source.classList.add('nd-app-dialog__source');
      const close = element('button', { className: 'nd-app-dialog__close', text: 'Close' });
      close.type = 'button';
      close.addEventListener('click', () => dialog.close());
      panel.append(heading, copy, source, close);
      dialog.append(panel);
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      document.body.append(dialog);
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function openAppInformation(kind) {
    const legacyControl = findLegacyControl(kind);
    if (legacyControl) legacyControl.click();
    else openFallbackDialog(kind);
  }

  function createBar() {
    const bar = element('div', { className: 'nd-app-bar' });
    bar.dataset.neurodeskTopBar = '';
    const identity = element('div', { className: 'nd-app-bar__identity' });
    identity.append(
      element('strong', { className: 'nd-app-bar__title', text: metadata.title }),
      element('span', { className: 'nd-app-bar__description', text: metadata.description }),
      element('span', { className: 'nd-app-bar__version', text: versionLabel(metadata.version) }),
    );
    const navigation = element('nav', { className: 'nd-app-bar__navigation' });
    navigation.setAttribute('aria-label', 'Application navigation');
    const informationActions = [
      createControlAction('about', 'About', 'about'),
      createControlAction('cite', 'Cite', 'cite'),
    ];
    if (findLegacyControl('standalone')) {
      informationActions.push(createControlAction('standalone', 'Standalone', 'standalone'));
    }
    informationActions.push(createControlAction('privacy', 'Privacy', 'privacy'));
    navigation.append(
      ...informationActions,
      (() => {
        const toggle = createAction('Light', 'theme');
        toggle.dataset.neurodeskThemeToggle = '';
        toggle.querySelector('span').dataset.neurodeskThemeLabel = '';
        return toggle;
      })(),
      createLink('More Apps', 'apps', metadata.moreAppsHref, 'More Neurodesk web apps'),
      createLink('GitHub', 'github', metadata.sourceHref, 'View this app on GitHub'),
    );
    bar.append(identity, navigation);
    return bar;
  }

  function replaceHeader(header) {
    if (!header || header.querySelector(':scope > .nd-app-bar')) return;
    header.dataset.neurodeskTopBarHost = '';
    header.append(createBar());
  }

  function preserveUtilityControls(header, selector) {
    if (!header || header.dataset.neurodeskUtilitiesMoved !== undefined) return;
    const controls = [...header.querySelectorAll(selector)];
    if (controls.length) {
      const utilityBar = element('div', { className: 'nd-app-utility-bar' });
      utilityBar.setAttribute('aria-label', 'Application tools');
      utilityBar.append(...controls);
      header.after(utilityBar);
    }
    header.dataset.neurodeskUtilitiesMoved = '';
    replaceHeader(header);
  }

  function installBars() {
    const shell = resolveShellAdapter(metadata.shell, document);
    shell.managedLinks.forEach((link) => { link.hidden = true; });
    shell.headers.forEach(replaceHeader);
    if (shell.utilities.length && shell.headers[0]) preserveUtilityControls(shell.headers[0], '[data-neurodesk-utility]');
    shell.overlays.forEach((landing) => {
      if (!landing.querySelector(':scope > .nd-app-bar')) { landing.dataset.neurodeskTopBarOverlay = ''; landing.prepend(createBar()); }
    });

    if (document.querySelector('[data-neurodesk-top-bar-host] > .nd-app-bar')) {
      document.querySelectorAll('body > .nd-app-bar--standalone').forEach((bar) => bar.remove());
    }

    if (!document.querySelector('.nd-app-bar')) {
      const bar = createBar();
      bar.classList.add('nd-app-bar--standalone');
      document.body.prepend(bar);
    }
  }

  function syncOptionalActions() {
    const registered = Boolean(findLegacyControl('standalone'));
    document.querySelectorAll('.nd-app-bar__navigation').forEach((navigation) => {
      const existing = navigation.querySelector('[data-neurodesk-shell-control="standalone"]');
      if (!registered && existing) existing.remove();
      if (registered && !existing) {
        const action = createControlAction('standalone', 'Standalone', 'standalone');
        const privacy = navigation.querySelector('[data-neurodesk-shell-control="privacy"]');
        navigation.insertBefore(action, privacy);
      }
    });
  }

  function syncScientificVersion() {
    const candidates = document.querySelectorAll('#appVersion, button[title="View changelog"]');
    const scientificVersion = [...candidates]
      .filter((candidate) => !candidate.closest('.nd-app-bar'))
      .map((candidate) => candidate.textContent.trim())
      .find((value) => /^v?\d+\.\d+(?:\.\d+)?(?:[-+ (].*)?$/.test(value));
    if (!scientificVersion) return;
    document.querySelectorAll('.nd-app-bar__version').forEach((node) => {
      const next = versionLabel(scientificVersion);
      if (node.textContent !== next) node.textContent = next;
    });
  }

  let scheduled = false;
  function refresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      installBars();
      syncOptionalActions();
      syncScientificVersion();
    });
  }

  installBars();
  syncOptionalActions();
  syncScientificVersion();
  new MutationObserver(refresh).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-neurodesk-control'],
  });
})();
