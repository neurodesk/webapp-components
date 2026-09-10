import { createElement } from '../core/dom.js';
import { ConsoleOutput } from './ConsoleOutput.js';
import { bindSectionDisclosure } from './bindSectionDisclosures.js';

/**
 * The shared technical log: a collapsed console below the viewer with Copy
 * and Clear in its header, following QSMbly's `console-container` pattern.
 *
 * Returns the root to append inside the viewer region, the output element and
 * a ConsoleOutput bound to it. Errors logged through the ConsoleOutput open
 * the disclosure automatically.
 */
export function renderConsole(config = {}, doc = globalThis.document) {
  const id = config.id || 'technicalLog';
  const output = createElement('div', {
    className: 'nd-console-output',
    id: config.outputId || `${id}Output`,
    'aria-label': config.outputLabel || 'Processing log',
    'data-disclosure-panel': '',
    ownerDocument: doc,
  });
  const title = createElement('button', {
    type: 'button',
    className: 'nd-console-title',
    'data-disclosure-toggle': '',
    text: config.title || 'Technical log',
    ownerDocument: doc,
  });
  const actions = createElement('div', { className: 'nd-console-actions', ownerDocument: doc });
  const root = createElement('div', {
    className: `nd-console-container${config.collapsed === false ? '' : ' collapsed'}`,
    id,
    'data-disclosure': '',
    ownerDocument: doc,
  }, [
    createElement('div', { className: 'nd-console-header', ownerDocument: doc }, [title, actions]),
    output,
  ]);
  const console = new ConsoleOutput({ element: output, mirrorToConsole: config.mirrorToConsole ?? false, maxLines: config.maxLines });

  const action = (label, onClick, extra = {}) => {
    const button = createElement('button', { type: 'button', className: 'nd-console-clear', text: label, ownerDocument: doc, ...extra });
    button.addEventListener('click', onClick);
    actions.appendChild(button);
    return button;
  };
  if (config.copy !== false) {
    action('Copy', async (event) => {
      const button = event.currentTarget;
      const copied = await console.copyToClipboard().catch(() => false);
      const label = button.textContent;
      button.textContent = copied ? 'Copied' : 'Copy failed';
      setTimeout(() => { button.textContent = label; }, 1200);
    }, { id: config.copyId || `${id}Copy` });
  }
  if (config.clear !== false) action('Clear', () => console.clear(), { id: config.clearId || `${id}Clear` });

  if (config.bind !== false && doc.defaultView?.MutationObserver) bindSectionDisclosure(root, doc);
  return {
    root,
    output,
    console,
    open() { root.classList.remove('collapsed'); },
    close() { root.classList.add('collapsed'); },
    log: (message, level) => console.log(message, level),
  };
}
