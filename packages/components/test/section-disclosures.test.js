import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bindSectionDisclosures } from '../src/ui/bindSectionDisclosures.js';

test('workflow disclosure state, input identity, focus and accordion behavior stay synchronized', async () => {
  const dom = new JSDOM(`<section id="input" data-disclosure data-disclosure-group="workflow">
    <h2 class="section-title"><button data-disclosure-toggle>Input</button></h2>
    <div data-disclosure-panel><input value="chosen"></div>
    </section><section id="settings" class="collapsed" data-disclosure data-disclosure-group="workflow">
    <h2 class="section-title"><button data-disclosure-toggle>Settings</button></h2>
    <div data-disclosure-panel><input value="default"></div></section>`);
  const doc = dom.window.document;
  bindSectionDisclosures(doc);
  bindSectionDisclosures(doc);
  const settings = doc.getElementById('settings');
  const toggle = settings.querySelector('button');
  const input = settings.querySelector('input');
  const flush = () => new Promise(resolve => dom.window.queueMicrotask(resolve));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  await flush();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.querySelector('#input [data-disclosure-panel]').hidden, true);
  input.value = 'edited';
  input.focus();
  settings.classList.add('collapsed');
  await flush();
  assert.equal(doc.activeElement, toggle);
  assert.equal(settings.querySelector('[data-disclosure-panel]').inert, true);
  settings.classList.remove('collapsed');
  await flush();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(input.value, 'edited');
  assert.equal(settings.querySelector('input'), input);
  dom.window.close();
});
