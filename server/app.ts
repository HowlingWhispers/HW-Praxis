// The Praxis server is deliberately thin. It serves the built interface and relays narration
// requests to NovelAI with the player's own key. It holds no play state: saves live in the browser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { relayChat, relayModels } from './novelai-relay.js';

export interface AppOptions {
  production?: boolean;
  // Injected in tests so no request leaves the machine.
  fetch?: typeof fetch;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const fetchImpl = options.fetch ?? fetch;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'praxis-api' }));

  app.get('/api/novelai/models', async (request, response, next) => {
    try {
      const result = await relayModels(fetchImpl, request.get('x-novelai-token'));
      response.status(result.status).json(result.body);
    } catch (error) { next(error); }
  });

  app.post('/api/novelai/chat', async (request, response, next) => {
    try {
      const result = await relayChat(fetchImpl, request.get('x-novelai-token'), request.body);
      response.status(result.status).json(result.body);
    } catch (error) { next(error); }
  });

  if (options.production) {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(directory, '../../dist');
    app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
    app.get('*splat', (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
  }

  // Never echoes request details, so a token cannot leak through an error.
  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({ error: 'Praxis request failed.' });
  });
  return app;
}
