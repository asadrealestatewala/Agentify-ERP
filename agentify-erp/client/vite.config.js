import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The proxy tells the API which address the browser used (hifi.localhost:5173), so workspace subdomains also work in dev.
  server: { port: 5173, proxy: Object.fromEntries(['/api', '/uploads'].map((p) => [p, { target: 'http://localhost:4000', configure: (proxy) => proxy.on('proxyReq', (pr, req) => pr.setHeader('x-forwarded-host', req.headers.host)) }])) },
  // the manifest lets the server tell the browser about the public page's files up front (server/src/services/fastLanding.js)
  build: { chunkSizeWarningLimit: 1500, manifest: true },
  // MapLibre 6 runs its tile worker as a separate module file, which src/maplibre.js has Vite bundle (with its shared code)
  worker: { format: 'es' },
});
