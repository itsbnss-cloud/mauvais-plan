import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { SERVER_TICK_RATE } from '../shared/constants';
import { RoomManager } from './rooms';

export interface AppOptions {
  /** Dossier du client compilé à servir (production). */
  staticDir?: string;
  /** Horloge injectable (tests du délai de reconnexion). */
  now?: () => number;
}

export function createGameServer(opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    pingInterval: 5000,
    pingTimeout: 8000,
    maxHttpBufferSize: 16_000,
  });
  const rooms = new RoomManager(io, opts.now);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const indexFile = path.join(opts.staticDir, 'index.html');
    app.use(express.static(opts.staticDir, { index: 'index.html', maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(indexFile));
  }

  io.on('connection', (socket) => rooms.handle(socket));

  let last = performance.now();
  const loop = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    rooms.tick(dt);
  }, 1000 / SERVER_TICK_RATE);
  const gcLoop = setInterval(() => rooms.gc(), 60_000);

  return {
    app,
    httpServer,
    io,
    rooms,
    async close() {
      clearInterval(loop);
      clearInterval(gcLoop);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
