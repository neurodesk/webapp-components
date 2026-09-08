#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { loadAppsRegistry, repoRoot } from './lib/apps-registry.mjs';

const modules = {
  musclemap: 'web/js/musclemap-app.js', vesselboost: 'web/js/vesselboost-app.js',
  spinalcordtoolbox: 'web/js/spinalcordtoolbox-app.js', calmar: 'web/js/lnm-app.js',
  seedseg: 'web/js/seedseg-app.js', qsmbly: 'js/qsm-app-romeo.js',
};
for (const app of (await loadAppsRegistry()).apps.filter(app => modules[app.id])) {
  const directory = join(repoRoot, 'apps', app.id);
  const htmlPath = join(directory, app.id === 'qsmbly' ? 'index.html' : 'web/index.html');
  let source = await readFile(htmlPath, 'utf8');
  const dom = new JSDOM(source, { includeNodeLocations: true });
  const edits = [];
  let index = 0;
  for (const title of dom.window.document.querySelectorAll('.sidebar-section > .section-title, .subsection > .subsection-title')) {
    const section = title.parentElement;
    if (section.hasAttribute('data-disclosure')) continue;
    const content = title.nextElementSibling;
    if (!content) throw new Error(`Missing section content in ${app.id}`);
    const id = section.id || `${app.id}-section-${++index}`;
    const at = dom.nodeLocation(section).startTag.endOffset - 1;
    const group = app.id === 'qsmbly' && section.classList.contains('sidebar-section') && section.id !== 'stage-buttons'
      ? ' data-disclosure-group="workflow"' : '';
    edits.push([at, at, ` data-disclosure${section.id ? '' : ` id="${id}"`}${group}`]);
    const panelAt = dom.nodeLocation(content).startTag.endOffset - 1;
    edits.push([panelAt, panelAt, ' data-disclosure-panel']);
    const location = dom.nodeLocation(title);
    let inner = source.slice(location.startTag.endOffset, location.endTag.startOffset);
    const help = [];
    inner = inner.replace(/<button\b[\s\S]*?<\/button>/g, button => { help.push(button); return ''; });
    const replacement = title.tagName === 'H2'
      ? `<h2 class="section-title"><button type="button" class="section-toggle" data-disclosure-toggle>${inner}</button>${help.join('')}</h2>`
      : `<button type="button" class="subsection-title" data-disclosure-toggle>${inner}</button>`;
    edits.push([location.startOffset, location.endOffset, replacement]);
  }
  for (const [start, end, replacement] of edits.sort((a,b) => b[0] - a[0])) source = source.slice(0,start) + replacement + source.slice(end);
  const toggle = source.indexOf('function toggleSection(section) {');
  if (toggle !== -1) {
    let end = source.indexOf('{', toggle) + 1;
    let depth = 1;
    while (depth && end < source.length) { const c=source[end++]; if(c === '{') depth++; if(c === '}') depth--; }
    source = source.slice(0,toggle) + source.slice(end);
  }
  await writeFile(htmlPath, source);
  const modulePath = join(directory, modules[app.id]);
  let module = await readFile(modulePath, 'utf8');
  if (!module.includes('bindSectionDisclosures')) module = "import { bindSectionDisclosures } from '@neurodesk/webapp-components/ui';\nbindSectionDisclosures(document);\n\n" + module;
  await writeFile(modulePath, module);
  console.log(`${app.id}: migrated ${edits.length / 3} disclosures`);
}
