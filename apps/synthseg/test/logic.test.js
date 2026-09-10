import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCt, outputStem } from '../src/logic.js';

test('output stem drops the NIfTI extension only', () => {
  assert.equal(outputStem('T1_head.nii.gz'), 'T1_head');
  assert.equal(outputStem('T1.NII'), 'T1');
  assert.equal(outputStem('scan.nii.gz.nii'), 'scan.nii.gz');
  assert.equal(outputStem('series_01'), 'series_01');
});

test('CT auto-detection keys on negative intensities', () => {
  assert.equal(looksLikeCt(new Float32Array([0, 12, 900])), false);
  assert.equal(looksLikeCt(new Float32Array([-1024, 0, 40])), true);
  assert.equal(looksLikeCt(new Float32Array(0)), false);
});
