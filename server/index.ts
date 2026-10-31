import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
// En production, le serveur compilé est dans dist/server et le client dans dist/client.
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, '../client');

const { httpServer, close } = createGameServer({
  staticDir: process.env.NODE_ENV === 'production' ? staticDir : undefined,
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Mauvais Plan — serveur prêt sur http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') console.log('En développement, ouvre le client Vite : http://localhost:5173');
});

const shutdown = () => {
  console.log('Arrêt du serveur…');
  close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
