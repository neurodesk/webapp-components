const bindings = new WeakMap();

export function bindSectionDisclosures(root = document) {
  for (const section of root.querySelectorAll('[data-disclosure]')) {
    if (bindings.has(section)) continue;
    const button = section.querySelector(':scope > .section-title > [data-disclosure-toggle], :scope > [data-disclosure-toggle], :scope > .console-header > [data-disclosure-toggle]');
    const panel = section.querySelector(':scope > [data-disclosure-panel]');
    if (!button || !panel) throw new Error('A disclosure needs a toggle button and content panel');
    panel.id ||= `${section.id}-content`;
    button.setAttribute('aria-controls', panel.id);
    const sync = () => {
      const collapsed = section.classList.contains('collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      if (collapsed && panel.contains(section.ownerDocument.activeElement)) button.focus();
      panel.hidden = collapsed;
      panel.inert = collapsed || section.classList.contains('step-disabled');
    };
    button.addEventListener('click', () => {
      if (section.classList.contains('collapsed') && section.dataset.disclosureGroup) {
        for (const other of root.querySelectorAll('[data-disclosure-group]')) {
          if (other !== section && other.dataset.disclosureGroup === section.dataset.disclosureGroup) other.classList.add('collapsed');
        }
      }
      section.classList.toggle('collapsed');
      sync();
    });
    const observer = new section.ownerDocument.defaultView.MutationObserver(sync);
    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    bindings.set(section, observer);
    sync();
  }
}
