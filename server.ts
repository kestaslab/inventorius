import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDatabaseApiRouter } from './src/server/databaseApi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const isProduction = process.env.NODE_ENV === 'production';

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  // Globalus JSON ir 413 dydžio klaidų apdorojimas po express.json()
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        error:
          'Užklausos arba failo dydis viršija serverio limitą (25 MB). Sumažinkite nuotrauką arba failą.',
      });
    }
    if (err && err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Netinkamas JSON užklausos formatas.',
      });
    }
    return next(err);
  });

  // API ir nuotraukų maršrutai (viskas su /api/* grąžina JSON, niekada nepereina į SPA HTML)
  app.use(createDatabaseApiRouter({ dataDir: DATA_DIR }));
  app.use('/api', (_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Nurodytas API maršrutas nerastas.',
    });
  });

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      throw new Error(
        `Produkcijos režime nerastas sukompiliuotas kliento failas (${indexHtmlPath}). Pirmiausia įvykdykite „bun run build“.`
      );
    }
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  const server = app.listen(PORT, HOST, () => {
    console.log(
      `[Inventoriaus Serveris] Pasileido (${isProduction ? 'production' : 'development'}): http://${HOST}:${PORT} | DATA_DIR=${DATA_DIR}`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[Inventoriaus Serveris] Gautas signalas ${signal}, stabdoma...`);
    server.close((err) => {
      if (err) {
        console.error('[Inventoriaus Serveris] Klaida uždarant serverį:', err);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('Serverio startavimo klaida:', err);
  process.exit(1);
});
