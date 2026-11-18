import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// bb.js starts its own Web Workers and loads wasm next to its files, so it and
// the Noir packages are served as-is instead of being pre-bundled.
const proving = ['@aztec-foundation/bb.js', '@noir-lang/noir_js', '@noir-lang/acvm_js', '@noir-lang/noirc_abi'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    // the SDK is linked from ../sdk; use one copy of each shared package
    dedupe: [...proving, 'viem'],
  },
  optimizeDeps: {
    exclude: [...proving, '@tint/sdk'],
    include: ['pako', 'comlink', 'idb-keyval', 'msgpackr', 'debug'],
    esbuildOptions: { target: 'es2022' },
  },
  server: { fs: { allow: ['..'] } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
