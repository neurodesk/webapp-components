import { createElement, appendChildren, clearElement } from '../core/dom.js';

/**
 * One centered, viewport-bounded information dialog for About, Cite, Privacy
 * and Standalone content, using QSMbly's modal geometry. Apps keep the
 * scientific content; the dialog owns the frame, title and close control.
 *
 *   const info = createInfoDialog();
 *   info.open('About SynthSR', '<p>…</p>');
 *   info.open('Citations', node, { wide: true });
 */
export function createInfoDialog(config = {}, doc = globalThis.document) {
  const title = createElement('h2', { id: config.titleId || `${config.id || 'infoDialog'}Title`, ownerDocument: doc });
  const body = createElement('div', { className: 'nd-dialog-body', id: config.bodyId || `${config.id || 'infoDialog'}Body`, ownerDocument: doc });
  const close = createElement('button', { type: 'button', className: 'nd-dialog-close', 'aria-label': 'Close', text: '×', ownerDocument: doc });
  const root = createElement('dialog', {
    className: 'nd-dialog',
    id: config.id || 'infoDialog',
    'aria-labelledby': title.id,
    ownerDocument: doc,
  }, [
    createElement('div', { className: 'nd-dialog-header', ownerDocument: doc }, [title, close]),
    body,
  ]);
  close.addEventListener('click', () => root.close());
  root.addEventListener('click', (event) => { if (event.target === root) root.close(); });
  (config.parent || doc.body).appendChild(root);

  function setContent(content) {
    clearElement(body);
    if (content == null) return;
    if (typeof content === 'string') body.innerHTML = content;
    else if (content instanceof doc.defaultView.HTMLTemplateElement) body.appendChild(content.content.cloneNode(true));
    else appendChildren(body, content);
  }

  return {
    root,
    title,
    body,
    open(heading, content, options = {}) {
      title.textContent = heading || '';
      setContent(content);
      root.classList.toggle('nd-dialog-wide', Boolean(options.wide));
      for (const [name, on] of Object.entries(options.classes || {})) root.classList.toggle(name, Boolean(on));
      if (typeof root.showModal === 'function') { if (!root.open) root.showModal(); }
      else root.setAttribute('open', '');
      body.scrollTop = 0;
      return root;
    },
    close() { root.close(); },
    setContent,
  };
}

/**
 * A copyable terminal command for Standalone dialogs.
 */
export function renderCommand(config = {}, doc = globalThis.document) {
  const code = createElement('code', { id: config.id, text: config.command || '', ownerDocument: doc });
  const button = createElement('button', {
    type: 'button',
    className: 'nd-btn nd-btn-secondary nd-btn-sm',
    text: 'Copy',
    'aria-label': config.label ? `Copy ${config.label}` : 'Copy command',
    dataset: { copyTarget: config.id },
    ownerDocument: doc,
  });
  const root = createElement('div', { className: 'nd-command', ownerDocument: doc }, [code, button]);
  button.addEventListener('click', async () => {
    let copied = false;
    try { await doc.defaultView.navigator.clipboard.writeText(code.textContent); copied = true; } catch { copied = false; }
    button.textContent = copied ? 'Copied' : 'Select and copy';
    config.onCopy?.(copied, code.textContent);
    setTimeout(() => { button.textContent = 'Copy'; }, 1200);
  });
  return { root, code, button };
}
