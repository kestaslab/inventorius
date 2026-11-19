# Proxmox VE diegimo, atnaujinimo ir atsarginių kopijų instrukcija

Ši instrukcija skirta **Telšių raj. Tryškių Lazdynų Pelėdos gimnazijos materialiojo turto inventorizacijos sistemai** paleisti ir prižiūrėti Proxmox VE aplinkoje (Debian 12 LXC konteineryje arba Docker aplinkoje).

> **Svarbu prieš pradedant:**
> - Programa yra pilno steko (**full-stack**) taikomoji programa: vienas Express/Node serveris (`server.ts`) aptarnauja tiek sukompiliuotą sąsają (`dist/`), tiek visus duomenų ir nuotraukų API (`/api/*`). **Niekada nenaudokite** vien statinių failų serverio (`npx serve -s dist`)!
> - Saugyklos užrakto failas yra `bun.lock` – visas priklausomybių diegimas ir kompiliacija turi naudoti **`bun`** (`bun install --frozen-lockfile`, `bun run build`, `bun run start`).
> - **Vieno proceso reikalavimas:** duomenų bazės įrašymo užraktas (`withDbLock`), operacijų istorija ir idempotencijos talpykla veikia vieno proceso atmintyje. **Visada paleiskite tik 1 procesą (`replicas: 1` arba PM2 `-i 1`, `fork` režimu).** Keli lygiagrečiai į tą patį JSON failą rašantys procesai gali sugadinti duomenis.
> - **Cloudflare Tunnel / prisijungimai:** Cloudflare Access / tunelio, PIN ir rolių nustatymų nekeiskite; tunelio taikinys turi likti įprastas vidinis HTTP (`http://127.0.0.1:3000` arba `http://<LXC-IP>:3000`).

---

## 1. Duomenų saugykla ir atsarginių kopijų tipai

Visi nuolatiniai programos duomenys saugomi kintamuoju `DATA_DIR` nurodytame kataloge (numatytasis – `./data`, Docker aplinkoje – `/app/data`):

- `${DATA_DIR}/school_database.json` – visa turto, kabinetų, skyrių, darbuotojų, judėjimų, gedimų, inventorizacijų ir aktų duomenų bazė.
- `${DATA_DIR}/photos/` – įkeltos turto ir gedimų nuotraukos.
- `${DATA_DIR}/backups/` – serverio automatiškai prieš importą ar schemos migraciją sukuriamos `school_database_*.json` kopijos.

**Kritinis skirtumas tarp kopijų tipų:**
1. **Automatinės kopijos `${DATA_DIR}/backups/school_database_*.json`:** jose saugomas tik JSON failas su nuorodomis `/api/photos/...`, todėl **be `${DATA_DIR}/photos/` katalogo jos nėra pilnavertės**.
2. **Pilna nešiojama JSON kopija (`/api/database/backup` arba mygtukas sąsajoje „Atsisiųsti pilną JSON atsarginę kopiją“):** per serverio užraktą įterpia visas nuotraukas tiesiai į JSON (`photos` objektą) – šį vieną failą galima perkelti į bet kurį kitą serverį.
3. **Pilnas katalogo archyvas (`./scripts/backup-data.sh`):** sukuria tiek nešiojamą `.json` kopiją (jei serveris veikia), tiek pilną `inventorius_full_<laikas>.tar.gz` archyvą su `school_database.json` ir `photos/`.

> **Išorinių kopijų rekomendacija:** vietinės kopijos serveryje (`backups_archive/` arba `data/backups/`) neapsaugo nuo serverio disko ar konteinerio gedimo. Bent po kiekvienos didesnės inventorizacijos ar nurašymo (ir periodiškai kas savaitę/mėnesį) nukopijuokite `.json` arba `.tar.gz` failą į išorinę saugyklą (Proxmox PBS, NAS arba tarnybinį kompiuterį / mokyklos saugią debesį).

---

## 2. A variantas – Diegimas per Docker / Docker Compose

Šis būdas naudoja saugykloje esančius `Dockerfile` ir `docker-compose.yml`.

### Reikalavimai LXC/VM viduje
- Įdiegtas Docker Engine ir `docker compose` įskiepis.
- Apsilankant per Proxmox LXC su Docker, įsitikinkite, kad konteineris palaiko `nesting=1` (`features: keyctl=1,nesting=1`).

### Žingsniai

```bash
# 1. Atsisiųskite saugyklą į /opt/inventorius
git clone <JUSU_REPO_URL> /opt/inventorius
cd /opt/inventorius

# 2. Paruoškite nuolatinį duomenų katalogą (išliks perkūrus konteinerį)
mkdir -p ./data/photos ./data/backups

# 3. Sukompiliuokite atvaizdą ir paleiskite konteinerį
docker compose build
docker compose up -d

# 4. Patikrinkite būseną ir /api/health
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

### Konteinerio atnaujinimas ir duomenų išlikimas (Docker)
```bash
cd /opt/inventorius

# 1. Prieš atnaujinant pasidarykite pilną kopiją
./scripts/backup-data.sh ./data ./backups_archive http://127.0.0.1:3000

# 2. Atnaujinkite kodą ir perkūrkite konteinerį (duomenys ./data lieka nepaliesti!)
git pull --ff-only
docker compose build --no-cache
docker compose up -d --force-recreate

# 3. Patikrinkite veikimą
curl -fsS http://127.0.0.1:3000/api/health
```

---

## 3. B variantas – Tiesioginis diegimas Proxmox Debian 12 LXC (be Docker, su PM2)

Rekomenduojamas minimalių resursų (80–150 MB RAM) būdas Proxmox LXC konteineriui.

### Žingsniai

```bash
# 1. Sistemos atnaujinimas ir pagrindiniai įrankiai
apt update && apt install -y curl git tar unzip

# 2. Node.js 22 LTS diegimas
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 3. Bun įdiegimas (atitinka saugyklos bun.lock)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun

# 4. Projekto klonavimas į /opt/inventorius
git clone <JUSU_REPO_URL> /opt/inventorius
cd /opt/inventorius

# 5. Priklausomybių diegimas pagal bun.lock ir produkcinė kompiliacija
bun install --frozen-lockfile
bun run build

# 6. Nuolatinio duomenų katalogo paruošimas ir vieno PM2 proceso paleidimas
mkdir -p /opt/inventorius/data/photos /opt/inventorius/data/backups
npm install -g pm2
NODE_ENV=production PORT=3000 DATA_DIR=/opt/inventorius/data pm2 start "$(command -v bun)" --interpreter none --name "inventorius" -i 1 -- run start
pm2 save
pm2 startup

# 7. Patikrinimas (palaukite 2 sek., kol serveris pasileis)
sleep 2
curl -fsS http://127.0.0.1:3000/api/health
```

---

## 4. Pirmasis duomenų importas ir pradinė patikra

1. Po pirmojo paleidimo serverio bazė yra **tuščia** (`dbExists: false`, demo duomenys automatiškai neįrašomi).
2. Atidarykite sistemą naršyklėje (`https://...` per Cloudflare Tunnel arba vietinį IP).
3. Skiltyje **„Savarankiškas diegimas ir kopijos“** (arba prisijungę po atstatymo) pasirinkite **„Atstatyti duomenų bazę iš failo (.JSON)“** ir įkelkite mokyklos JSON kopiją, **ARBA** per terminalą įvykdykite:
   ```bash
   ./scripts/restore-data.sh /kelias/iki/mokyklos_kopijos.json /opt/inventorius/data
   # Jei serveris jau veikė – perkraukite jį, kad perskaitytų atkurtą DB:
   pm2 restart inventorius   # (arba: docker compose restart)
   ```
4. Jei įkeliama sena kopija be `organizationSettings`, sistema **nepriskiria** kitos mokyklos rekvizitų automatiškai kaip patvirtinto fakto – administratorius ar ūkvedys turi nueiti į **„Ataskaitos ir aktai“ → „Įstaigos rekvizitai“**, suvesti/patvirtinti mokyklos rekvizitus ir paspausti **„Patvirtinti ir išsaugoti rekvizitus“**. Istoriniai užbaigti dokumentai neperrašomi.

---

## 5. Atsarginių kopijų darymas ir atkūrimas

### Rankinis kopijos sukūrimas
```bash
cd /opt/inventorius
./scripts/backup-data.sh ./data ./backups_archive http://127.0.0.1:3000
```
Sugeneruojami failai kataloge `backups_archive/`:
- `inventorius_portable_<TIMESTAMP>.json` (vientisas failas su nuotraukomis)
- `inventorius_full_<TIMESTAMP>.tar.gz` (`school_database.json` + `photos/`)

### Automatinės Proxmox lygio kopijos
- Proxmox VE pusėje sukonfigūruokite periodinę LXC konteinerio `vzdump` kopiją (pvz., naktinę kopiją į Proxmox Backup Server ar išorinį diską).

### Duomenų bazės atkūrimas
Atkūrimo skriptas pirmiausia patikrina kopijos JSON/nuotraukų vientisumą laikiname kataloge ir tik tada padaro esamų duomenų saugos kopiją (`data/backups/pre_restore_*.tar.gz`) bei atnaujina tikslinį katalogą:
```bash
cd /opt/inventorius
./scripts/restore-data.sh /opt/inventorius/backups_archive/inventorius_portable_YYYYMMDD_HHMMSS.json /opt/inventorius/data

# Būtina perkrauti servisą po disko pakeitimo:
pm2 restart inventorius        # tiesioginiam LXC PM2 diegimui
# ARBA:
docker compose restart         # Docker Compose diegimui
```

---

## 6. Saugus atnaujinimas ir grąžinimas atgal (Rollback)

### Tiesioginiam LXC PM2 diegimui
Naudokite paruoštą saugų skriptą `/opt/inventorius/update.sh`:
```bash
cd /opt/inventorius
chmod +x update.sh scripts/*.sh
./update.sh
```
Skriptas:
- patikrina, ar nėra neužfiksuotų pakeitimų (nenaudoja `git reset --hard` ar `git clean -fd`),
- įsimena ankstesnį commit'ą,
- padaro atsarginę kopiją prieš atnaujinant,
- atnaujina kodą per `git pull --ff-only`,
- įdiegia priklausomybes su `bun install --frozen-lockfile`, sukompiliuoja `dist/`,
- perkrauna vienintelį `inventorius` PM2 procesą ir patikrina `/api/health`.

### Grąžinimas į ankstesnę versiją (Rollback)
Jei nauja versija nepavyko ar neveikia `/api/health`:
1. Grąžinkite kodą į ankstesnį veikusį commit'ą (arba ankstesnį Docker atvaizdo tag'ą):
   ```bash
   cd /opt/inventorius
   git checkout <ANKSTESNIS_COMMIT_ARBA_TAGAS>
   bun install --frozen-lockfile
   bun run build
   ```
2. **Tik tuo atveju, jei naujoji versija jau spėjo pakeisti duomenų schemą (didesnė `version`)**, atkurkite prieš atnaujinimą sukurtą kopiją (senesnė programos versija sąmoningai atmes naujesnės schemos DB per `/api/health` su HTTP `503`):
   ```bash
   ./scripts/restore-data.sh /opt/inventorius/backups_archive/inventorius_full_<PRIES_ATNAUJINIMA>.tar.gz /opt/inventorius/data
   ```
   > **Svarbu:** niekada neatkurkite senos kopijos automatiškai be patikros, jei po atnaujinimo jau buvo įvesta naujų duomenų – prieš atkuriant pasidarykite esamos būsenos kopiją.
3. Perkraukite servisą ir patikrinkite `/api/health`.

---

## 7. Greita patikra po paleidimo arba perkrovimo

```bash
# 1. Serverio sveikatos ir DB būsenos patikra (turi grąžinti HTTP 200 ir "status":"ok")
curl -i http://127.0.0.1:3000/api/health

# 2. Neegzistuojantis API maršrutas privalo grąžinti JSON 404 (ne HTML!)
curl -i http://127.0.0.1:3000/api/neegzistuoja

# 3. Pagrindinis puslapis turi grąžinti HTTP 200 HTML
curl -I http://127.0.0.1:3000/
```
