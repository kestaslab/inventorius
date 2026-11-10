import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Dedicated server-side data directory (survives git pulls and rebuilds)
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'school_database.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    serverTime: new Date().toISOString(),
    dbExists: fs.existsSync(DB_FILE)
  });
});

// API: Get central database from Proxmox server disk
app.get('/api/database', (req, res) => {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      return res.setHeader('Content-Type', 'application/json').send(content);
    }
    return res.json(null);
  } catch (err) {
    console.error('Klaida skaitant duomenų bazę:', err);
    return res.status(500).json({ error: 'Failed to read server database' });
  }
});

// API: Save central database to Proxmox server disk (atomic write)
app.post('/api/database', (req, res) => {
  try {
    const data = req.body;
    if (!data) {
      return res.status(400).json({ error: 'Missing data payload' });
    }
    const tempFile = path.join(DATA_DIR, `school_db_${Date.now()}.tmp`);
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
    return res.json({ success: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Klaida įrašant duomenų bazę:', err);
    return res.status(500).json({ error: 'Failed to persist server database' });
  }
});

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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Inventoriaus Serveris] Pasileido sėkmingai: http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Serverio startavimo klaida:', err);
  process.exit(1);
});
