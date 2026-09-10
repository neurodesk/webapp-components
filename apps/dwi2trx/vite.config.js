// Keep dwi2trx on the shared Vite, shell, theme, and isolation policy used by
// the other bundled Neurodesk apps.
import { neurodeskViteConfig } from '../../scripts/lib/vite-app-config.mjs'

export default neurodeskViteConfig({
  appId: 'dwi2trx',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  // These browser runtimes load WASM or WGSL assets through native module URLs.
  // Vite's development prebundler cannot process those imports.
  optimizeDeps: {
    exclude: ['@dipy/gpu-streamlines', '@niivue/dcm2niix', '@niivue/niimath'],
  },
})
