// The Praxis server is deliberately thin. It serves the built interface and, later, the
// Orbis launch claim and generation relay. It holds no play state: saves live in the browser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';

export function createApp(options: { production?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'praxis-api' }));

  if (options.production) {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(directory, '../../dist');
    app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
    app.get('*splat', (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Praxis request failed.';
    response.status(500).json({ error: message });
  });
  return app;
}
