import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// package.json is the only version source.
const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }).version || '0.0.0';
let buildCommit = process.env.PRAXIS_BUILD_COMMIT || 'unknown';
try {
  if (buildCommit === 'unknown') buildCommit = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
} catch {
  // Git metadata may be absent in a packaged deployment.
}

export default defineConfig({
  plugins: [react()],
  define: {
    __PRAXIS_VERSION__: JSON.stringify(`v${packageVersion}+${buildCommit}`),
  },
  server: {
    port: 5176,
    // Codespaces serves the dev server from *.app.github.dev.
    allowedHosts: ['.app.github.dev'],
    proxy: { '/api': 'http://127.0.0.1:8791' },
  },
  preview: { port: 4176 },
});
