# Mokyklos Inventoriaus Valdymo Sistema (Self-Hosted)

Išsami, švietimo įstaigoms pritaikyta materialinių vertybių ir inventoriaus apskaitos sistema su skyriais, kabinetais, vartotojų vaidmenimis, QR kodų inventorizacija bei ataskaitų (nurašymo, perdavimo, apyrašų) generavimu, optimizuota savarankiškam diegimui Proxmox LXC arba Docker aplinkoje.

### User Review & Critical Decisions

> [!IMPORTANT] Rekomendacija Jūsų Proxmox serveriui:
> Vietoj sunkios virtualios mašinos (VM) ar sudėtingų duomenų bazių klasterių, geriausias sprendimas Proxmox aplinkoje yra **Debian/Alpine LXC konteineris su Docker Compose arba tiesioginiu Node.js procesu ir SQLite / JSON failine baze**:
> 1. **Minimalūs resursai**: naudoja vos 80–150 MB operatyviosios atminties (RAM) ir beveik 0% CPU ramybės būsenoje.
> 2. **Momentinės atsarginės kopijos**: Proxmox `vzdump` / snapshot padaro pilną atsarginę kopiją per kelias sekundes, o visa duomenų bazė yra viename faile (`inventory.db`), kurį taip pat galima atsisiųsti tiesiai iš administratoriaus pulto.
> 3. **Paprastas paleidimas**: pateikiamas paruoštas `docker-compose.yml` ir paprastas `systemd` skriptas.

- **Patvirtinta diegimo platforma**: Proxmox LXC konteineris (Node.js + SQLite/JSON saugykla + Docker paruošimas).
- **Vaidmenų modelis**: Administratorius (IT/Ūkio vedėjas), Materialiai atsakingas asmuo (Mokytojas/Laborantas), Komisijos narys / Auditorius.
- **Ataskaitų modulis**: Spausdinimui pritaikyti apyrašai, perdavimo-priėmimo aktai ir nurašymo aktai su komisijos parašų laukais, taip pat Excel/CSV eksportas.
- **Etikečių ir QR modulis**: Automatinis QR kodų generavimas su tiesiogine spaudos maketo peržiūra (A4 lipdukų lapams) ir skenavimas per kamerą.

---

### 1. Overview & Core Concept

- **Paskirtis**: Mokyklos materialiojo turto (IT įrangos, baldų, mokymo priemonių, laboratorinių prietaisų) registravimas, judėjimo sekimas tarp kabinetų/skyrių, metinė inventorizacija ir nurašymo procedūros.
- **Tikslinė auditorija**: Mokyklos ūkio dalies vedėjas, IT administratorius, direktoriaus pavaduotojas ūkio reikalams, mokytojai (kabinetų vedėjai) bei inventorizacijos komisijos nariai.
- **Pagrindinė vertė**: Popierinių žurnalų ir fragmentuotų „Excel“ lentelių pakeitimas centralizuota, patikima vietine sistema, atitinkančia Lietuvos švietimo įstaigų turto apskaitos reikalavimus, veikiančia mokyklos vidiniame tinkle be jokių mėnesinių prenumeratos mokesčių.

---

### 2. User Experience & Visual Design

- **Navigacija ir struktūra**:
  - Kairysis valdymo meniu su aiškiomis zonomis: *Suvestinė (Dashboard)*, *Inventoriaus sąrašas*, *Skyriai ir kabinetai*, *Atsakingi asmenys ir vaidmenys*, *Perkėlimo operacijos*, *Inventorizacija (QR skeneris)*, *Ataskaitos ir aktai*, *Atsarginės kopijos (Self-host pultas)*.
  - Viršutinė juosta su greitąja paieška pagal inventorinį numerį arba serijos numerį, skyriaus filtru bei aktyvaus vartotojo vaidmens perjungikliu testavimui ir demonstracijai.
- **Vizualinė tapatybė ir estetika**:
  - *Stilius*: Švarus, solidus institucinis / SaaS dizainas pagal šiuolaikinius švietimo sistemų standartus. Jokių rėkiančių spalvų, jokių nereikalingų animacijų.
  - *Spalvų paletė*: Tamsiai mėlyna / šiferio pagrindo paletė (Slate `#0F172A`, `#1E293B`), aiškus baltas fonas darbo zonai (`#FFFFFF` / `#F8FAFC`), institucinė tamsiai mėlyna / kobalto akcento spalva (`#1D4ED8` / `#2563EB`).
  - *Tipografija*: `Plus Jakarta Sans` antraštėms ir navigacijai, `Public Sans` skaitomam tekstui, o visiems inventoriniams numeriams, sumoms ir datoms – griežtas `font-mono tabular-nums` šriftas.
  - *Metaduomenų disciplina*: Nenaudojamos įkyrios spalvotos piliulės. Kategorijos, skyriai ir datos pateikiami aiškiu tekstu su subtiliais skirtukais (`·` arba `/`). Būsenos (Veikiantis, Remontuojamas, Nurašytas) žymimos santūriais tekstiniais indikatoriais.
- **Interaktyvios formos ir ataskaitų peržiūra**:
  - Modalinis langas naujam daiktui su greituoju inventorinio numerio automatinio suteikimo generatoriumi.
  - Pilnas PDF/A4 stiliaus ataskaitų peržiūros šablonas su spausdinimo parinktimi (`window.print` optimizuotas CSS) ir parašų zonomis.
  - QR kodų generavimas: pasirenkamas dydis (24, 40 ar 65 lipdukai A4 lape).

---

### 3. Key Product Decisions & Trade-Offs

- **1 sprendimas: Duomenų bazės pasirinkimas savarankiškam diegimui (Proxmox)**
  - *Pasirinkimas*: Integruotas SQLite variklis kartu su automatiniu JSON eksportu/importu.
  - *Priežastis*: Proxmox LXC konteineryje nereikia atskirai konfigūruoti PostgreSQL ar MySQL serverio, prižiūrėti slaptažodžių, atverti papildomų prievadų ar rūpintis atskirų servisų gedimais. Visi duomenys gyvena viename faile.
  - *Alternatyvos*: PostgreSQL būtų perteklinis vienos mokyklos keliems tūkstančiams įrašų ir reikalautų 3–4 kartus daugiau RAM.
- **2 sprendimas: Vartotojų vaidmenų ir teisių kontrolė (RBAC)**
  - *Pasirinkimas*: 3 aiškūs lygiai:
    1. *Administratorius / Ūkio vedėjas*: kuria skyrius, redaguoja visus įrašus, patvirtina perkėlimus, atlieka nurašymus, valdo naudotojus ir eksportuoja atsargines kopijas.
    2. *Materialiai atsakingas asmuo*: mato savo kabineto/skyriaus turtą, gali inicijuoti perdavimo prašymą kitam mokytojui, žymėti gedimus.
    3. *Auditorius / Komisijos narys*: patikros rėžimas su QR skenavimu, inventoriaus fakto fiksavimas (Rasta / Trūksta / Pažeista) ir aktų generavimas.
- **3 sprendimas: Ataskaitų sistema pagal Lietuvos standartus**
  - *Pasirinkimas*: Paruošti trys oficialūs formatai su rekvizitais:
    1. *Inventorizacijos apyrašas* (pagal kabinetą/asmenį su stulpeliais: Nr., Inv. nr., Pavadinimas, Mato vnt., Kiekis, Įsigijimo vertė, Būklė).
    2. *Turto perdavimo-priėmimo aktas* (perdavėjas, priėmėjas, pagrindas, parašai).
    3. *Turto nurašymo ir likvidavimo aktas* (komisijos pirmininkas, nariai, nurašymo priežastis: fizinis/moralinis nusidėvėjimas).

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Proxmox VE Host                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │               Debian / Alpine LXC Container                      │  │
│  │                                                                  │  │
│  │   ┌──────────────────────────────────────────────────────────┐   │  │
│  │   │          Node.js Express Full-Stack Server               │   │  │
│  │   │  - REST API (/api/inventory, /api/departments, /api/...) │   │  │
│  │   │  - RBAC Middleware & Session Management                  │   │  │
│  │   │  - Backup & Restore Handlers (ZIP/JSON/SQLite)           │   │  │
│  │   └───────────────▲──────────────────────────┬───────────────┘   │  │
│  │                   │                          │                   │  │
│  │   ┌───────────────┴──────────┐   ┌───────────▼───────────────┐   │  │
│  │   │     inventory.db         │   │   Vite + React SPA        │   │  │
│  │   │     (SQLite Storage)     │   │   - Dashboard & Filtrai   │   │  │
│  │   │   Auto-backup to .json   │   │   - QR Generator/Scanner  │   │  │
│  │   │                          │   │   - Print-ready A4 Aktai  │   │  │
│  │   └──────────────────────────┘   └───────────────────────────┘   │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Duomenų modelis**:
  - `departments` (id, name, code, building, description) – pvz., Pagrindinis korpusas, Skyrius A.
  - `rooms` (id, departmentId, number, name, floor, defaultResponsiblePersonId) – pvz., 204 kab. (IT klasė).
  - `users` (id, fullName, email, role, departmentId, phone) – mokytojai, ūkio vedėjas, administratorius.
  - `inventory_items` (id, inventoryNumber, serialNumber, name, category, departmentId, roomId, responsibleUserId, acquisitionDate, purchasePrice, status, condition, notes, qrCode).
  - `movement_history` (id, itemId, fromRoomId, toRoomId, fromUserId, toUserId, date, reason, actNumber).
  - `audit_sessions` (id, year, title, status, startDate, completedDate, committeeMembers).
  - `audit_records` (id, sessionId, itemId, scannedAt, scannedByUserId, status: 'MATCH' | 'MISSING' | 'RELOCATED', notes).
  - `writeoff_acts` (id, actNumber, date, reason, committeeMembers, itemsList, approvedBy).

- **Savarankiško diegimo paketas (Self-Hosting)**:
  - Sistema bus pilnai sukomplektuota su `Dockerfile` ir `docker-compose.yml`, kad vartotojas galėtų paleisti sistemą viena komanda savo Proxmox LXC serveryje (`docker compose up -d`), arba paleisti tiesiogiai per `npm run build && npm start`.
  - Atsarginių kopijų mygtukas vartotojo sąsajoje: 1 paspaudimu atsisiunčiamas pilnas duomenų archyvas ir 1 paspaudimu atstatomas.

---

### 5. Implementation Steps (Plan Execution)

1. **Branduolys ir duomenų schema**: Sukurti duomenų modelius, tipus, duomenų saugojimo sluoksnį bei demonstracinius realistiškus mokyklos duomenis (kabinetai, kompiuteriai, baldai, atsakingi asmenys).
2. **Skyrių ir kabinetų valdymo modulis**: Sukurti skyrių hierarchiją su kabinetais ir atsakingais asmenimis.
3. **Inventoriaus katalogas su paieška ir filtrais**: Sukurti interaktyvią lentelę su greita paieška pagal inventorinį numerį, kategoriją, būklę, skyrių.
4. **Perkėlimo ir nurašymo vedliai**: Sukurti procedūras turto perkėlimui į kitą kabinetą su automatiškai sugeneruojamu perdavimo aktu.
5. **QR kodų ir etikečių generatorius**: Sukurti etikečių spausdinimo maketą ir kameros skenerį greitai inventorizacijai telefone ar planšetėje.
6. **Oficialių ataskaitų ir aktų generatorius**: Paruošti spausdinimui pritaikytus inventorizacijos apyrašus, nurašymo aktus su komisijos narių sąrašu.
7. **Self-Hosting pultas ir eksportas**: Sukurti duomenų importo/eksporto (JSON/Excel) bei atsarginių kopijų valdymo skiltį su diegimo instrukcija Proxmox LXC konteineriui.
