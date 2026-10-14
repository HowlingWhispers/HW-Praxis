import { createApp } from './app.js';

const port = Number(process.env.PORT || 8791);
const server = createApp({ production: process.env.NODE_ENV === 'production' }).listen(port, '127.0.0.1', () => {
  console.log(`Praxis API listening on ${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
