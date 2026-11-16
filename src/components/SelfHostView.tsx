import React, { useState } from 'react';
import { 
  Server, 
  Download, 
  Upload, 
  RotateCcw, 
  Copy, 
  Check, 
  Terminal, 
  FileCode, 
  Database,
  Cpu,
  ShieldCheck,
  HardDrive,
  Boxes,
  Building2,
  FileText,
  AlertTriangle,
  Info,
  Calendar,
  CheckCircle2,
  Eye,
  Loader2,
} from 'lucide-react';
import { StorageService, SyncState } from '../utils/storage';
import { getTodayVilniusDate } from '../utils/dateUtils';
import { User, InventoryItem, Room, MovementRecord, WriteOffAct } from '../types/inventory';

interface SelfHostViewProps {
  currentUser: User;
  onRefreshData: () => void;
  items?: InventoryItem[];
  rooms?: Room[];
  movements?: MovementRecord[];
  writeOffActs?: WriteOffAct[];
  syncState?: SyncState;
}

export const SelfHostView: React.FC<SelfHostViewProps> = ({
  currentUser,
  onRefreshData,
  items,
  rooms,
  movements,
  writeOffActs,
  syncState,
}) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([]);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResettingServer, setIsResettingServer] = useState(false);

  const isAdmin = currentUser.role === 'admin';
  const isLocalPreview = Boolean(syncState?.localPreviewMode);

  // Current database statistics
  const currentItems = items ?? StorageService.getItems();
  const currentRooms = rooms ?? StorageService.getRooms();
  const currentMovements = movements ?? StorageService.getMovements();
  const currentWriteOffs = writeOffActs ?? StorageService.getWriteOffActs();

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleDownloadBackup = async () => {
    try {
      setIsExporting(true);
      const json = await StorageService.exportFullBackupAsync();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tryskiu-mokykla-inventorius-backup-${getTodayVilniusDate()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      setIsImporting(true);
      setRestoreMessage(null);
      setRestoreWarnings([]);
      try {
        const result = await StorageService.importFullBackup(content);
        if (result.ok) {
          const extra = result.migrated ? ' Duomenų struktūra sėkmingai migruota į 1.1.0 versiją.' : '';
          const bkp = result.backupFile ? ` Ankstesnės serverio bazės kopija išsaugota: ${result.backupFile}.` : '';
          setRestoreMessage({
            type: 'success',
            text: `Duomenų bazė sėkmingai atstatyta iš atsarginės kopijos!${extra}${bkp}`,
          });
          setRestoreWarnings(result.warnings || []);
          onRefreshData();
        } else {
          setRestoreMessage({
            type: 'error',
            text: result.error || 'Klaida: netinkamas failo formatas arba sugadinti duomenys.',
          });
        }
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleActivateLocalPreview = () => {
    StorageService.activateLocalDemoPreview();
    onRefreshData();
    setShowResetConfirmModal(false);
    setRestoreMessage({
      type: 'success',
      text: 'Įjungta vietinė demonstracinė peržiūra šiame naršyklės lange. Centrinė serverio duomenų bazė nepakeista.',
    });
  };

  const handleExitLocalPreview = async () => {
    await StorageService.exitLocalDemoPreview();
    onRefreshData();
    setRestoreMessage({
      type: 'success',
      text: 'Grįžta prie pagrindinių centrinio serverio duomenų.',
    });
  };

  const executeResetCentralServer = async () => {
    setIsResettingServer(true);
    try {
      const res = await StorageService.resetCentralServerToDemo();
      if (res.ok) {
        onRefreshData();
        setShowResetConfirmModal(false);
        const bkp = res.backupFile ? ` Ankstesnės bazės kopija išsaugota: ${res.backupFile}.` : '';
        setRestoreMessage({
          type: 'success',
          text: `Centrinė serverio bazė pakeista pradiniais duomenimis.${bkp}`,
        });
      } else {
        setShowResetConfirmModal(false);
        setRestoreMessage({ type: 'error', text: res.error });
      }
    } finally {
      setIsResettingServer(false);
    }
  };

  const dockerComposeCode = `# Svarbu: paleiskite tik 1 procesą (replicas: 1), nes JSON DB užraktas veikia atmintyje.
services:
  mokyklos-inventorius:
    build: .
    container_name: mokykla-inventorius
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
    volumes:
      # Nuolatinė DB (school_database.json), nuotraukų (photos/) ir automatinių kopijų (backups/) saugykla
      - ./data:/app/data
    deploy:
      replicas: 1
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s`;

  const proxmoxDebianCommands = `# Išsami instrukcija taip pat pateikta faile PROXMOX_DIEGIMAS.md
# 1. Paleiskite Proxmox Container 107 (Debian 12) ir atidarykite konsolę (pct enter 107)

# 2. Įdiekite pagrindinius paketus, Node.js 22 LTS ir Bun (pagal saugyklos bun.lock):
apt update && apt install -y curl git tar unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
curl -fsSL https://bun.sh/install | bash
ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun

# 3. Nuklonuokite projekto kodą į /opt/inventorius ir paruoškite duomenų katalogą:
git clone <JUSU_GITHUB_REPO_URL> /opt/inventorius
cd /opt/inventorius
mkdir -p /opt/inventorius/data/photos /opt/inventorius/data/backups

# 4. Įdiekite priklausomybes pagal bun.lock ir sukompiliuokite produkcijai:
bun install --frozen-lockfile
bun run build

# 5. Paleiskite VIENINTELĮ server.ts procesą per PM2 (NE npx serve, nes reikalingas /api/*):
npm install -g pm2
NODE_ENV=production PORT=3000 DATA_DIR=/opt/inventorius/data pm2 start bun --name "inventorius" -i 1 -- run start
pm2 save
pm2 startup

# 6. Patikrinkite serverio sveikatą ir API:
curl -fsS http://127.0.0.1:3000/api/health`;

  const cloudflareTunnelSnippet = `# 1. Cloudflare Tunnel nustatymai (autentifikavimo ir rolių nekeiskite):
# Nurodykite vidinį HTTP taikinį (ne HTTPS), nes Node/Express serveris klausosi HTTP:
# Type: HTTP
# URL: http://127.0.0.1:3000 (arba http://<LXC-IP>:3000)

# 2. Saugus atnaujinimas ir atsarginė kopija Proxmox LXC konteineryje:
# Saugykloje jau paruošti skriptai:
#   ./scripts/backup-data.sh   – pilna nešiojama JSON kopija + tar.gz (DB ir photos/)
#   ./scripts/restore-data.sh  – patikra laikiname kataloge ir saugus atkūrimas
#   ./update.sh                – git status patikra, kopija, git pull --ff-only,
#                                bun install --frozen-lockfile, bun run build,
#                                PM2 perkrovimas (-i 1) ir /api/health patikra

cd /opt/inventorius
chmod +x update.sh scripts/*.sh
./update.sh

# Rankiniam pilnam archyvui prieš didelius pakeitimus:
./scripts/backup-data.sh ./data ./backups_archive http://127.0.0.1:3000`;

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Server className="w-5 h-5 text-blue-600" />
              ) : (
                <Database className="w-5 h-5 text-indigo-600" />
              )}
              <h2 className="text-base font-bold text-slate-900">
                {isAdmin
                  ? 'Savarankiško diegimo (Proxmox / Docker) ir duomenų saugyklos centras'
                  : 'Mokyklos inventoriaus atsarginės duomenų kopijos'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isAdmin
                ? 'Rekomendacijos, atsarginės kopijos ir parengtos konfigūracijos Jūsų Proxmox VE serveriui'
                : 'Atsisiųskite nepriklausomą mokyklos turto, kabinetų ir judėjimo žurnalo kopiją į savo kompiuterį'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Atsisiųsti atsarginę kopiją (.JSON)</span>
            </button>
          </div>
        </div>

        {/* Database Content Stats Pill Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 mt-4 border-t border-slate-100">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5 text-blue-600" />
              <span>Inventoriaus vienetai</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {currentItems.length} vnt.
            </div>
            <div className="text-[10px] text-slate-400">Įtraukta į archyvą</div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Kabinetai ir patalpos</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {currentRooms.length} kab.
            </div>
            <div className="text-[10px] text-slate-400">Su atsakingais asmenimis</div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-600" />
              <span>Turto judėjimo įrašai</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {currentMovements.length} įr.
            </div>
            <div className="text-[10px] text-slate-400">Istoriniai perdavimai</div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
              <span>Nurašymo aktai</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {currentWriteOffs.length} akt.
            </div>
            <div className="text-[10px] text-slate-400">Archyvuoti dokumentai</div>
          </div>
        </div>
      </div>

      {/* Backup and Restore Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Backup Management */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Duomenų atsarginės kopijos valdymas
            </h3>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Eksportuokite visus gimnazijos inventoriaus įrašus, skyrius, patalpas, vartotojus ir judėjimo istoriją į nepriklausomą JSON archyvą. Šį failą galite saugoti kompiuteryje ar perkelti į kitą įrenginį.
          </p>

          <div className="space-y-3 pt-1">
            <button
              onClick={handleDownloadBackup}
              disabled={isExporting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 border border-slate-300 rounded-lg transition-colors cursor-pointer"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <Download className="w-4 h-4 text-blue-600" />}
              <span>{isExporting ? 'Ruošiama atsarginė kopija su nuotraukomis...' : 'Atsisiųsti pilną JSON atsarginę kopiją'}</span>
            </button>

            <div className="relative">
              <input
                type="file"
                accept=".json"
                disabled={isImporting}
                onChange={handleFileRestore}
                id="file-restore"
                className="hidden"
              />
              <label
                htmlFor="file-restore"
                className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors ${isImporting ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin text-emerald-600" /> : <Upload className="w-4 h-4 text-emerald-600" />}
                <span>{isImporting ? 'Tikrinama ir atkuriama į serverį...' : 'Atstatyti duomenų bazę iš failo (.JSON)'}</span>
              </label>
            </div>

            {isLocalPreview && (
              <button
                type="button"
                onClick={handleExitLocalPreview}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Išjungti vietinę peržiūrą ir grįžti prie serverio duomenų</span>
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-[11px] font-medium text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Demonstraciniai duomenys (peržiūra arba centrinės DB atkūrimas)</span>
              </button>
            )}

            {restoreMessage && (
              <div className={`p-3 rounded-lg text-xs font-medium ${
                restoreMessage.type === 'success' 
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {restoreMessage.text}
              </div>
            )}

            {restoreWarnings.length > 0 && (
              <div className="p-3 rounded-lg text-xs bg-amber-50 text-amber-950 border border-amber-300 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Senos kopijos suderinamumo ir duomenų pastabos ({restoreWarnings.length}):</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Istoriniai duomenys ir nepatvirtinti įstaigos rekvizitai nebuvo išgalvoti ar tyliai perrašyti. Peržiūrėkite sąrašą ir, jei reikia, patvirtinkite įstaigos rekvizitus skiltyje „Ataskaitos ir aktai“ arba sutvarkykite nurašymus „Inventoriaus sąraše“.
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-900 max-h-40 overflow-y-auto">
                  {restoreWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right: Recommendations for Staff / Facilities Manager */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Rekomendacijos ūkvedžiui ir atsakingiems asmenims
            </h3>
          </div>

          <div className="space-y-2.5 text-xs text-slate-600">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-900 block">Kada rekomenduojama atsisiųsti kopiją:</strong>
                <span className="text-[11px] text-slate-500">
                  Prieš pradedant metinę inventorizaciją, patvirtinus didesnius turto nurašymus, prieš programos atnaujinimą arba bent kartą per mėnesį profilaktiškai.
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2.5">
              <HardDrive className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-900 block">Kur saugoti atsarginį failą (išorinė kopija):</strong>
                <span className="text-[11px] text-slate-500">
                  Serverio katalogas <code>data/backups/</code> saugo tik automatines JSON kopijas be <code>data/photos/</code> failų ir neapsaugo nuo serverio disko gedimo. Atsisiųstą pilną <code>.json</code> kopiją (su nuotraukomis) arba <code>.tar.gz</code> archyvą būtinai saugokite atskirame įrenginyje, Proxmox PBS ar NAS.
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-900 block">Pilnas atkūrimas su nuotraukomis:</strong>
                <span className="text-[11px] text-slate-500">
                  Šiame puslapyje atsisiųstas <code>.json</code> failas per <code>/api/database/backup</code> įtraukia ir visas nuotraukas, todėl gali atkurti sistemą net tuščiame naujame serveryje.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ADMIN-ONLY SECTION: Proxmox LXC Architecture, Docker Compose & CLI Scripts */}
      {isAdmin && (
        <>
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Administratoriaus ir IT priežiūros skiltis
              </span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>
          </div>

          {/* Proxmox Architecture Recommendation */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-600" />
              Proxmox serverio architektūra: LXC konteineris (ID 107)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-lg space-y-1.5">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-blue-600" />
                  Minimalūs resursai
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Debian LXC konteineris naudoja vos <strong>80–120 MB RAM</strong> (palyginti su pilna VM, kuri reikalauja bent 2–4 GB vien operacinei sistemai).
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-lg space-y-1.5">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Momentinės vzdump kopijos
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Proxmox su ZFS padaro pilną konteinerio kopiją vos per kelias sekundes. Duomenų bazė yra faile, todėl nėra pavojaus sugadinti atskirą DB servisą.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-lg space-y-1.5">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-purple-600" />
                  Zero-Maintenance saugykla (1 procesas)
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Jokių išorinių PostgreSQL/MySQL servisų – duomenys laikomi atomiškai atnaujinamame <code>school_database.json</code> faile ir <code>photos/</code> kataloge. Visada paleiskite tik <strong>1</strong> Node/Express procesą (<code>-i 1</code> arba <code>replicas: 1</code>).
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Docker Compose */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-blue-600" />
                  docker-compose.yml
                </h3>
                <button
                  onClick={() => copyToClipboard(dockerComposeCode, 'docker')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {copiedSection === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSection === 'docker' ? 'Nukopijuota!' : 'Kopijuoti'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Paruoštas paleidimui su Docker Compose bet kuriame Linux serveryje:
              </p>
              <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg text-[11px] font-mono overflow-x-auto">
                {dockerComposeCode}
              </pre>
            </div>

            {/* Cloudflare Tunnel & update.sh Guide */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Cloudflare Tunnel & update.sh
                  </h3>
                </div>
                <button
                  onClick={() => copyToClipboard(cloudflareTunnelSnippet, 'tunnel')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {copiedSection === 'tunnel' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSection === 'tunnel' ? 'Nukopijuota!' : 'Kopijuoti'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-500">
                1 paspaudimo atnaujinimo skriptas Proxmox konteineryje:
              </p>
              <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
                {cloudflareTunnelSnippet}
              </pre>
            </div>
          </div>

          {/* Proxmox Direct Installation Guide */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Proxmox Debian 12 LXC diegimo komandos (bun + server.ts + PM2)
                </h3>
              </div>
              <button
                onClick={() => copyToClipboard(proxmoxDebianCommands, 'commands')}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
              >
                {copiedSection === 'commands' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSection === 'commands' ? 'Nukopijuota!' : 'Kopijuoti komandas'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Komandos atitinka saugyklos <code>bun.lock</code>, <code>server.ts</code> ir <code>PROXMOX_DIEGIMAS.md</code> instrukciją:
            </p>
            <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed border border-slate-800">
              {proxmoxDebianCommands}
            </pre>
          </div>
        </>
      )}

      {/* In-app Reset Confirmation Modal (Explicitly separates local preview vs central server reset) */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Demonstraciniai duomenys: pasirinkite veiksmą
                </h4>
                <p className="text-xs text-slate-500">
                  Atskirkite saugią vietinę peržiūrą nuo centrinės serverio bazės keitimo
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50/60 space-y-2">
                <div className="font-bold text-blue-950 flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-blue-600" />
                  <span>1. Tik vietinė peržiūra (rekomenduojama bandymams)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Demonstraciniai duomenys bus rodomi <strong>tik šiame naršyklės lange</strong>. Centrinė gimnazijos duomenų bazė serveryje liks 100 % nepakeista.
                </p>
                <button
                  type="button"
                  onClick={handleActivateLocalPreview}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  Įjungti vietinę peržiūrą
                </button>
              </div>

              <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50/50 space-y-2">
                <div className="font-bold text-rose-950 flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4 text-rose-600" />
                  <span>2. Perrašyti centrinę serverio bazę</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Visi centrinėje serverio duomenų bazėje esantys įrašai bus pakeisti pradiniais demonstraciniais duomenimis visiems naudotojams. Prieš perrašant serveris automatiškai išsaugos esamos bazės kopiją <code>data/backups/</code> kataloge.
                </p>
                <button
                  type="button"
                  disabled={isResettingServer}
                  onClick={executeResetCentralServer}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  {isResettingServer ? 'Perrašoma serverio bazė...' : 'Perrašyti centrinę serverio bazę'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Atšaukti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
