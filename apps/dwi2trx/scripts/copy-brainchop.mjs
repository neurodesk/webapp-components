#!/usr/bin/env node
// Stage @brainchop/mindgrab's WebGPU wasm into public/ so Vite serves it under
// `assetPath`. It cannot stay in node_modules: these three are fetched by URLs
// computed at run time, so Vite never emits them. WebGPU only — see AGENTS.md.

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '..', 'node_modules', '@brainchop', 'mindgrab', 'dist')
const to = join(here, '..', 'public', 'brainchop')

const files = [
  'worker.js',
  'brainchop-mindgrab-gpu.js',
  'brainchop-mindgrab-gpu.wasm',
]

mkdirSync(to, { recursive: true })
for (const f of files) copyFileSync(join(from, f), join(to, f))
