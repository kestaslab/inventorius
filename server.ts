import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDatabaseApiRouter } from './src/server/databaseApi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

// Dedicated server-side data directory (survives git pulls and rebuilds)
const DATA_DIR = path.join(__dirname, 'data');
app.use(createDatabaseApiRouter({ dataDir: DATA_DIR }));

// Full-stack Vite dev vs Production handling
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Inventoriaus Serveris] Pasileido sėkmingai: http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Serverio startavimo klaida:', err);
  process.exit(1);
});
