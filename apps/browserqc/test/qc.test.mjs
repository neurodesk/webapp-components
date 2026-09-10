import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSidecar, readQcReport } from '../src/qc.ts';

test('malformed worker JSON rejects immediately', async () => {
  await assert.rejects(readQcReport(new Blob(['not-json'])), SyntaxError);
});

test('QC report validates its object and provenance before use', async () => {
  for (const value of [null, [], {}, { provenance: null }, { provenance: [] }]) {
    await assert.rejects(readQcReport(new Blob([JSON.stringify(value)])), /provenance/);
  }
  const report = { cnr: 1.5, snrd_total: null, provenance: { niimath: 'test' } };
  assert.deepEqual(await readQcReport(new Blob([JSON.stringify(report)])), report);
});

test('DICOM metadata is consumed by its scan and never leaks into the next NIfTI', () => {
  const metadata = { PatientName: 'Patient A' };
  for (const name of ['scan.dcm', 'IM000001', 'scan.nii.gz']) {
    const current = bindSidecar(metadata, null, [{ name }, { name: 'scan.json' }]);
    assert.deepEqual(current, { bind: metadata, staged: null });
    assert.deepEqual(bindSidecar(null, current.staged, [{ name: 'other.nii.gz' }]), {
      bind: null,
      staged: null,
    });
  }
});

test('separately selected JSON is consumed by either a NIfTI or a DICOM scan', () => {
  const metadata = { EchoTime: 0.003 };
  const staged = bindSidecar(metadata, null, [{ name: 'scan.JSON' }]);
  assert.deepEqual(staged, { bind: null, staged: metadata });
  for (const name of ['IM000001', 'scan.nii.gz']) {
    assert.deepEqual(bindSidecar(null, staged.staged, [{ name }]), {
      bind: metadata,
      staged: null,
    });
  }
});
