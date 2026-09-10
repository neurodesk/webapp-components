#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const bucket = 'neurodeskorg/webapps-bucket';
const snapshots = [
  {
    repository: 'sbollmann/neurodesk-webapps-assets',
    repoType: 'dataset',
    revision: 'e0a056b3d6b2b075bab5b780281af17fc9d6421d',
  },
  {
    repository: 'sbollmann/lnm-webapp-models',
    repoType: 'dataset',
    revision: '6fd71cdb20e094c10312b42779abee8375f4142e',
  },
  {
    repository: 'sbollmann/sct-webapp-data',
    repoType: 'dataset',
    revision: '55c9462a14bc9c84cf093c348cffda9148099df9',
  },
  {
    repository: 'sbollmann/qsm',
    repoType: 'dataset',
    revision: '94bb63332d311b979b606d3d8f1b2cb2e9f389f5',
  },
  {
    repository: 'sbollmann/isles26-nnunet-d507-topk10',
    repoType: 'model',
    revision: 'bdc5eccca9a874aef8d042d8daf8088181a644de',
  },
].map(snapshot => ({
  ...snapshot,
  name: snapshot.repository.split('/')[1],
  prefix: `${snapshot.repository.split('/')[1]}/${snapshot.revision}`,
}));

const resolveBase = `https://huggingface.co/buckets/${bucket}/resolve`;
const urlReplacements = [
  {
    pattern: /https:\/\/huggingface\.co\/datasets\/sbollmann\/neurodesk-webapps-assets\/resolve\/(?:main|[0-9a-f]{40})/g,
    replacement: `${resolveBase}/neurodesk-webapps-assets/e0a056b3d6b2b075bab5b780281af17fc9d6421d`,
  },
  {
    pattern: /https:\/\/huggingface\.co\/datasets\/sbollmann\/lnm-webapp-models\/resolve\/(?:main|[0-9a-f]{40})/g,
    replacement: `${resolveBase}/lnm-webapp-models/6fd71cdb20e094c10312b42779abee8375f4142e`,
  },
  {
    pattern: /https:\/\/huggingface\.co\/datasets\/sbollmann\/sct-webapp-data\/resolve\/(?:main|[0-9a-f]{40})/g,
    replacement: `${resolveBase}/sct-webapp-data/55c9462a14bc9c84cf093c348cffda9148099df9`,
  },
  {
    pattern: /https:\/\/huggingface\.co\/datasets\/sbollmann\/qsm\/resolve\/(?:main|[0-9a-f]{40})/g,
    replacement: `${resolveBase}/qsm/94bb63332d311b979b606d3d8f1b2cb2e9f389f5`,
  },
  {
    pattern: /https:\/\/huggingface\.co\/sbollmann\/isles26-nnunet-d507-topk10\/resolve\/(?:main|[0-9a-f]{40})/g,
    replacement: `${resolveBase}/isles26-nnunet-d507-topk10/bdc5eccca9a874aef8d042d8daf8088181a644de`,
  },
  {
    pattern: /https:\/\/huggingface\.co\/datasets\/sbollmann\/neurodesk-webapps-assets\/tree\/(?:main|[0-9a-f]{40})/g,
    replacement: `https://huggingface.co/buckets/${bucket}/tree/neurodesk-webapps-assets/e0a056b3d6b2b075bab5b780281af17fc9d6421d`,
  },
  {
    pattern: /sbollmann\/(?:neurodesk-webapps-assets|lnm-webapp-models|sct-webapp-data|qsm|isles26-nnunet-d507-topk10)/g,
    replacement: bucket,
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function sourceUri(snapshot) {
  return `hf://${snapshot.repoType}s/${snapshot.repository}@${snapshot.revision}/`;
}

function destinationUri(snapshot) {
  return `hf://buckets/${bucket}/${snapshot.prefix}/`;
}

function printPlan() {
  console.log(`hf buckets create ${bucket} --exist-ok`);
  console.log(`hf buckets settings ${bucket} --public`);
  for (const snapshot of snapshots) {
    console.log(`hf cp ${sourceUri(snapshot)} ${destinationUri(snapshot)}`);
  }
}

function apply() {
  run('hf', ['buckets', 'create', bucket, '--exist-ok']);
  run('hf', ['buckets', 'settings', bucket, '--public']);
  for (const snapshot of snapshots) {
    console.log(`Copying ${snapshot.repository}@${snapshot.revision}`);
    run('hf', ['cp', sourceUri(snapshot), destinationUri(snapshot)]);
  }
}

function listJson(args) {
  return JSON.parse(run('hf', args, { capture: true }));
}

function filesByPath(entries, prefix = '') {
  const files = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry.size)) continue;
    const path = prefix && entry.path.startsWith(`${prefix}/`)
      ? entry.path.slice(prefix.length + 1)
      : entry.path;
    if (path === '.gitattributes') continue;
    files.set(path, { size: entry.size, xetHash: entry.xet_hash ?? null });
  }
  return files;
}

function verifySnapshot(snapshot) {
  const source = filesByPath(listJson([
    `${snapshot.repoType}s`, 'list', snapshot.repository, '-R', '--revision', snapshot.revision, '--format', 'json',
  ]));
  const destination = filesByPath(listJson([
    'buckets', 'list', `${bucket}/${snapshot.prefix}`, '-R', '--format', 'json',
  ]), snapshot.prefix);

  const errors = [];
  for (const [path, expected] of source) {
    const actual = destination.get(path);
    if (!actual) errors.push(`${path}: missing`);
    else if (actual.size !== expected.size) errors.push(`${path}: ${actual.size} bytes, expected ${expected.size}`);
    else if (actual.xetHash && expected.xetHash && actual.xetHash !== expected.xetHash) {
      errors.push(`${path}: Xet hash mismatch`);
    }
  }
  for (const path of destination.keys()) {
    if (!source.has(path)) errors.push(`${path}: unexpected destination object`);
  }
  if (errors.length) throw new Error(`${snapshot.name} verification failed:\n${errors.join('\n')}`);
  const bytes = [...source.values()].reduce((total, file) => total + file.size, 0);
  console.log(`${snapshot.name}: ${source.size} objects, ${bytes} bytes verified`);
  return { objects: source.size, bytes };
}

function verify() {
  let objects = 0;
  let bytes = 0;
  for (const snapshot of snapshots) {
    const result = verifySnapshot(snapshot);
    objects += result.objects;
    bytes += result.bytes;
  }
  console.log(`total: ${objects} objects, ${bytes} bytes verified`);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function sourceResolveUrl(snapshot, path) {
  const root = snapshot.repoType === 'dataset'
    ? `https://huggingface.co/datasets/${snapshot.repository}`
    : `https://huggingface.co/${snapshot.repository}`;
  return `${root}/resolve/${snapshot.revision}/${encodePath(path)}`;
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function verifyUnhashedContent() {
  let objects = 0;
  let bytes = 0;
  for (const snapshot of snapshots) {
    const sourceEntries = listJson([
      `${snapshot.repoType}s`, 'list', snapshot.repository, '-R',
      '--revision', snapshot.revision, '--format', 'json',
    ]);
    const files = sourceEntries.filter(entry => (
      Number.isInteger(entry.size) && entry.path !== '.gitattributes' && !entry.xet_hash
    ));
    for (const file of files) {
      const [source, destination] = await Promise.all([
        fetchBytes(sourceResolveUrl(snapshot, file.path)),
        fetchBytes(`${resolveBase}/${snapshot.prefix}/${encodePath(file.path)}`),
      ]);
      if (!source.equals(destination)) {
        throw new Error(`${snapshot.name}/${file.path}: public bytes differ`);
      }
      objects += 1;
      bytes += source.length;
    }
    console.log(`${snapshot.name}: ${files.length} non-Xet objects compared byte for byte`);
  }
  console.log(`total: ${objects} non-Xet objects and ${bytes} bytes compared byte for byte`);
}

function checkReferences() {
  const paths = run('git', [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ], { capture: true }).split('\0').filter(Boolean);
  const stale = [];
  const pattern = /sbollmann\/(?:neurodesk-webapps-assets|lnm-webapp-models|sct-webapp-data|qsm|isles26-nnunet-d507-topk10)/g;
  for (const path of paths) {
    if (path === 'scripts/hf-webapp-assets.mjs' || path.startsWith('.audit/')) continue;
    const content = readFileSync(path);
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      stale.push(`${path}:${line}:${match[0]}`);
    }
  }
  if (stale.length) throw new Error(`Stale sbollmann webapp asset references:\n${stale.join('\n')}`);
  console.log('No stale sbollmann webapp asset references');
}

function rewriteReferences() {
  const paths = run('git', [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ], { capture: true }).split('\0').filter(Boolean);
  const changed = [];
  for (const path of paths) {
    if (path === 'scripts/hf-webapp-assets.mjs' || path.startsWith('.audit/')) continue;
    const content = readFileSync(path);
    if (content.includes(0)) continue;
    const original = content.toString('utf8');
    const rewritten = urlReplacements.reduce(
      (text, rule) => text.replace(rule.pattern, rule.replacement),
      original,
    );
    if (rewritten === original) continue;
    writeFileSync(path, rewritten);
    changed.push(path);
  }
  console.log(`Rewrote ${changed.length} files`);
  for (const path of changed) console.log(path);
}

const command = process.argv[2] ?? 'plan';
if (command === 'plan') printPlan();
else if (command === 'apply') apply();
else if (command === 'verify') verify();
else if (command === 'verify-content') await verifyUnhashedContent();
else if (command === 'check-references') checkReferences();
else if (command === 'rewrite-references') rewriteReferences();
else throw new Error(`Unknown command: ${command}`);
