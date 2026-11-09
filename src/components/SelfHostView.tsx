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
  HardDrive
} from 'lucide-react';
import { StorageService } from '../utils/storage';

interface SelfHostViewProps {
  onRefreshData: () => void;
}

export const SelfHostView: React.FC<SelfHostViewProps> = ({ onRefreshData }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleDownloadBackup = () => {
    const json = StorageService.exportFullBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiu-mokykla-inventorius-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const success = StorageService.importFullBackup(content);
      if (success) {
        setRestoreMessage({ type: 'success', text: 'Duomenų bazė sėkmingai atstatyta iš atsarginės kopijos!' });
        onRefreshData();
      } else {
        setRestoreMessage({ type: 'error', text: 'Klaida: netinkamas failo formatas arba sugadinti duomenys.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetData = () => {
    if (confirm('Ar tikrai norite atkurti pradines demonstracines mokyklos reikšmes? Visi nauji pakeitimai bus anuliuoti.')) {
      StorageService.resetToDefaults();
      onRefreshData();
      setRestoreMessage({ type: 'success', text: 'Grąžinti pradiniai demonstraciniai duomenys.' });
    }
  };

  const dockerComposeCode = `version: '3.8'

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
    volumes:
      # Proxmox LXC mount: duomenų bazės išsaugojimas
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3`;

  const proxmoxDebianCommands = `# 1. Paleiskite Proxmox Container 107 (Inventorius) ir atidarykite konsolę (>_ Console arba pct enter 107)

# 2. Įdiekite reikalingus paketus ir naujausią Node.js LTS (v22):
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 3. Nuklonuokite inventoriaus projekto kodą iš GitHub į /opt/inventorius:
git clone <JUSU_GITHUB_REPO_URL> /opt/inventorius
cd /opt/inventorius

# 4. Įdiekite priklausomybes ir sukompiliuokite produkcijai:
npm install
npm run build

# 5. Įdiekite PM2 procesų valdymo įrankį ir paleiskite servisą:
npm install -g pm2
pm2 start "npx serve -s dist -l 3000" --name "inventorius"
pm2 save
pm2 startup

# Sistema automatiškai veiks fone portu 3000 ir pasileis po bet kurio Proxmox perkrovimo!`;

  const cloudflareTunnelSnippet = `# 1. SVARBI PASTABA Cloudflare Tunnel nustatymams:
# Nuotraukoje matoma, kad nustatyta https://192.168.1.91:3000.
# Pakeiskite į HTTP (ne HTTPS), nes vietinis Node servisas veikia įprastu HTTP:
# Type: HTTP
# URL: 192.168.1.91:3000 (arba http://192.168.1.91:3000)

# 2. Vieno paspaudimo atnaujinimo skriptas (update.sh) Proxmox konteineryje:
cat << 'EOF' > /opt/inventorius/update.sh
#!/bin/bash
echo "=== Atnaujinama Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistema ==="
cd /opt/inventorius
git pull
npm install
npm run build
pm2 restart inventorius
echo "=== Atnaujinimas sėkmingai baigtas! ==="
EOF
chmod +x /opt/inventorius/update.sh

# Kaskart padarius pakeitimus GitHub repozitorijoje, konteineryje pakaks paleisti:
/opt/inventorius/update.sh`;

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Savarankiško diegimo (Self-Hosting) ir Proxmox centras
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Rekomendacijos, atsarginės kopijos ir parengtos konfigūracijos Jūsų Proxmox VE serveriui
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Atsisiųsti atsarginę kopiją (.JSON)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Proxmox Architecture Recommendation */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-emerald-600" />
          Rekomendacija Jūsų Proxmox serveriui: LXC konteineris vietoj VM
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
              Proxmox su ZFS padaro pilną konteinerio kopiją vos per 2–3 sekundes. Duomenų bazė yra faile, todėl nėra pavojaus sugadinti atskirą DB servisą.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-lg space-y-1.5">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-purple-600" />
              Zero-Maintenance priežiūra
            </div>
            <p className="text-slate-600 leading-relaxed">
              Jokių periodinių PostgreSQL/MySQL versijų atnaujinimų ar lūžimų. Viskas valdoma per paprastą vieno pulto JSON/SQLite failą.
            </p>
          </div>
        </div>
      </div>

      {/* Backup and Restore Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Backup Management */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600" />
            Duomenų bazių atsarginės kopijos
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Eksportuokite visus mokyklos inventoriaus įrašus, skyrius, patalpas, vartotojus ir judėjimo istoriją į nepriklausomą JSON archyvą. Šį failą galite perkelti į bet kurį kitą serverį ar kompiuterį.
          </p>

          <div className="space-y-3 pt-2">
            <button
              onClick={handleDownloadBackup}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>Atsisiųsti pilną JSON atsarginę kopiją</span>
            </button>

            <div className="relative">
              <input
                type="file"
                accept=".json"
                onChange={handleFileRestore}
                id="file-restore"
                className="hidden"
              />
              <label
                htmlFor="file-restore"
                className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 text-emerald-600" />
                <span>Atstatyti duomenų bazę iš failo (.JSON)</span>
              </label>
            </div>

            <button
              onClick={handleResetData}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-[11px] font-medium text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Atkurti pradinius demonstracinius duomenis</span>
            </button>

            {restoreMessage && (
              <div className={`p-3 rounded text-xs ${
                restoreMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {restoreMessage.text}
              </div>
            )}
          </div>
        </div>

        {/* Right: Docker Compose Configuration */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-blue-600" />
              docker-compose.yml
            </h3>
            <button
              onClick={() => copyToClipboard(dockerComposeCode, 'docker')}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
            >
              {copiedSection === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'docker' ? 'Nukopijuota!' : 'Kopijuoti'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Paruoštas paleidimui su Docker Compose bet kuriame Linux serveryje:
          </p>
          <pre className="bg-slate-900 text-slate-100 p-3 rounded-md text-[11px] font-mono overflow-x-auto">
            {dockerComposeCode}
          </pre>
        </div>
      </div>

      {/* Proxmox Direct Installation Guide */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900">
              Proxmox Debian 12 LXC diegimo komandos žingsnis po žingsnio
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
          Galite nukopijuoti šias komandas ir tiesiogiai įvykdyti savo Proxmox Debian konteineryje:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed border border-slate-800">
          {proxmoxDebianCommands}
        </pre>
      </div>

      {/* Cloudflare Tunnel & GitHub Update Guide */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Cloudflare Tunnel integracija ir atnaujinimai iš GitHub
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
        <p className="text-xs text-slate-600">
          Štai kaip prijungti Cloudflare tunelį ir pasidaryti 1 paspaudimo atnaujinimo skriptą konteineryje:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed border border-slate-800">
          {cloudflareTunnelSnippet}
        </pre>
      </div>
    </div>
  );
};
