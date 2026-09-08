import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderSidebarSection } from '../src/ui/renderSidebarSection.js';

test('sidebar disclosures retain controls and state across closing and reopening', () => {
  const { document } = new JSDOM('<input value="default">').window;
  const input = document.querySelector('input');
  let changes = 0;
  input.addEventListener('change', () => changes++);
  const section = renderSidebarSection({ title: 'Advanced', content: input, collapsed: true }, document);
  document.body.append(section.root);
  assert.equal(section.root.tagName, 'DETAILS');
  assert.equal(section.title.tagName, 'SUMMARY');
  assert.equal(section.root.open, false);
  section.title.click();
  assert.equal(section.root.open, true);
  input.value = 'edited';
  section.title.click();
  section.title.click();
  assert.equal(section.content.querySelector('input'), input);
  assert.equal(input.value, 'edited');
  input.dispatchEvent(new document.defaultView.Event('change'));
  assert.equal(changes, 1);
  section.setDisabled(true);
  assert.equal(section.content.inert, true);
  section.setDisabled(false);
  assert.equal(section.content.inert, false);
});
