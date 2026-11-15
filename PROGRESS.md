# Inventoriaus valdymo programos taisymo pažanga

## Atlikti etapai

### 1 etapas – Duomenų išsaugojimas ir apsauga nuo praradimo (Atlikta)
- Serveris yra pagrindinis tiesos šaltinis (`/api/database`, `/api/mutate`, `/api/database/import`, `/api/database/backup`).
- Įdiegta versijų / revizijų kontrolė (`x-db-revision`, `409 Conflict` tikrinimas) ir nesusikertančių pakeitimų sujungimas, atomiškas įrašymas per laikiną failą su automatinėmis atsarginėmis kopijomis prieš pilną importą ar migraciją.
- Nuotraukos saugomos serverio failų sistemoje (`/api/photos/:id`), kad nedidintų kiekvienos mutacijos užklausų.
- Kliento sąsajoje aiškiai atvaizduojamos būsenos („Išsaugoma“, „Išsaugota serveryje“, „Nepavyko išsaugoti“) ir atskirta vietinė demonstracinė peržiūra nuo centrinės serverio bazės keitimo.

### 2 etapas – Turto redagavimas ir duomenų ryšiai (Atlikta)
- Redaguojant turtą per `ItemModal` / `SAVE_ITEM` išsaugomi visi neforminiai laukai (`defectReports`, `activeDefectNote`, `writeOff*`, `barcode`, `lastAuditDate`).
- Įdiegtos griežtos kainos, likutinės vertės (`residualValue <= purchasePrice`), kalendorinės datos, unikalumo ir kabineto–skyriaus atitikties validacijos.
- Apsaugotas skyrių, kabinetų ir atsakingų asmenų ryšių vientisumas: neleidžiama tiesiogiai ištrinti naudojamų įrašų be perkėlimo ar archyvavimo, o istoriniuose judėjimo įrašuose išsaugomos pavadinimų momentinės kopijos.

### 3 etapas – Nurašymas ir atkūrimas (Atlikta)
- **Pasirinkta vieninga tvirtinimo taisyklė:** nurašymas tvirtinamas tik per visą susietą nurašymo aktą kartu (`APPROVE_WRITEOFF_ACT`). Kelių daiktų akte negalima patvirtinti vieno daikto paliekant kitus nenurašytus (jei daikto nurašyti nereikia, jis pirmiausia atmetamas). Visi tvirtinimo mygtukai tiek `ReportsView`, tiek `InventoryListView` suderinti su šia taisykle.
- **Vienas nuoseklus projektų ir daiktų srautas:**
  - Neleidžiama to paties daikto pateikti į kelis aktyvius nurašymo projektus (`CONFIRM_WRITEOFF` grąžina `409 Conflict`).
  - Galima pateikti daiktą į naują projektą arba pridėti prie esamo nepatvirtinto projekto (`targetActId`).
  - Aktų numeriai (`NUR-YYYY-NNN`) generuojami ir jų unikalumas tikrinamas serveryje; pašalintas kliento atsitiktinis numeravimas (`Math.random()`).
- **Atmetimo ir pakartotinio tvirtinimo apsaugos:**
  - Atmetus daiktą (`REJECT_WRITEOFF`), išsaugoma atmetimo istorija tiek daikte (`writeOffRejectionHistory`), tiek akte (`rejectedItems`).
  - Jei projekte nebelieka nė vieno daikto, aktas pažymimas kaip atšauktas (`cancelled`) ir negali būti patvirtintas; jei projekte lieka kitų daiktų, jų procesas tęsiamas toliau.
  - Neleidžiama pakartotinai patvirtinti jau patvirtinto akto. Prieš tvirtinimą serveryje patikrinami visi akto daiktai; klaidos atveju neatliekami jokie daliniai pakeitimai.
  - Patvirtinimo metu `writeOffActId`, `writeOffActNumber`, `writtenOffDate`, `writtenOffYear` ir `writeOffReason` atnaujinami viena atomine serverio operacija.
- **Atkūrimas iš archyvo ir pakartotinis nurašymas:**
  - Atkuriant daiktą (`RESTORE_FROM_ARCHIVE`) neleidžiama automatiškai parinkti būklės „Gera“ – privaloma nurodyti faktinę būklę ir atkūrimo priežastį.
  - Istorinis patvirtintas `WriteOffAct` nekeičiamas ir neištrinamas; ankstesnis nurašymas ir jo atšaukimas (kas, kada, kokia būklė ir kodėl atkūrė) užfiksuojamas daikto istorijoje (`writeOffHistory`) bei rodomas `ItemDetailModal`. Atkurtą daiktą vėliau galima teisėtai nurašyti nauju aktu.
- **Metų filtras `ReportsView`:**
  - Pakeitus metų filtrą `filterActYear`, rodomas, eksportuojamas (Word / Excel) ir tvirtinamas aktas visada parenkamas tik iš filtruoto sąrašo (`displayedActs`). Esant tuščiam sąrašui, rodoma aiški tuščia būsena ir užblokuojami veiksmai bei eksportai.
- **Suderinamumas su senomis JSON kopijomis:**
  - Neatitikimai tarp senų aktų ir daiktų neišgalvojami ir tyliai neperrašomi – migracija ir importas grąžina aiškius perspėjimus (`warnings[]`), išsaugo ankstesnės bazės atsarginę kopiją, o sąsajoje pateikiami saugūs žinomų ryšių sutvarkymo veiksmai (`RECONCILE_WRITEOFF_ISSUE`).

### Papildomi pataisymai prieš 4 etapą (sinchronizavimo eilė ir istorija) (Atlikta)
- **Vienos operacijos atmetimas nebevalo visos laukiančių pakeitimų eilės (`src/utils/storage.ts`):**
  - Gavus HTTP `400`, `413` arba `404`, pašalinama tik atmesta operacija (ir įrašoma į `rejectedOps`), atnaujinamas serverio duomenų vaizdas neišvalant likusių eilės elementų.
  - Nuo atmestos operacijos tiesiogiai ar tranzityviai priklausomi veiksmai (naudojant `getTouchedEntityKeys` ir `getOperationReferencedKeys`) išsaugomi eilėje ir aiškiai pažymimi būsena `needs_resolution` su priežastimi bei valdymu sąsajoje (`Bandyti dar kartą` / `Atsisakyti`).
  - Nepriklausomi teisingi pakeitimai išlieka eilėje ir toliau siunčiami į serverį.
- **Konfliktų apsauga išsaugant tikrą `baseRevision` (`src/utils/storage.ts`, `src/server/databaseApi.ts`):**
  - Sėkmingai išsaugojus pirmą eilės operaciją, kitų laukiančių operacijų `baseRevision` nebepakeliamas automatiškai.
  - Serveryje tikrinama įrašų revizijų istorija (`entityHistory` su `clientOpId`), kad tas pats klientas galėtų nuosekliai atlikti kelis savo eilės pakeitimus (`precedingClientOpIds`), tačiau bet koks kito naudotojo pakeitimas tuo pačiu metu patikimai sugrąžintų `409 Conflict` ir neperrašytų kito naudotojo darbo.
- **Patikima darbinės atminties eilė nepavykus įrašyti į `localStorage` (`src/utils/storage.ts`, `src/components/Header.tsx`, `src/App.tsx`):**
  - Autoritetinė operacijų eilė laikoma darbinėje atmintyje (`memoryPendingOps`), todėl `localStorage` klaidų (`QuotaExceededError` ir pan.) atveju užklausos vis tiek realiai siunčiamos į serverį ir niekada negrąžinama klaidinga sėkmė be realaus serverio patvirtinimo.
  - Kai pakeitimai lieka tik atmintyje (`memoryOnlyQueue`), sąsaja aiškiai įspėja apie galimą praradimą uždarius ar perkrovus puslapį ir niekada nerodo „Išsaugota serveryje“.
- **Istorinių inventorizacijos dokumentų apsauga (`src/utils/dbOperations.ts`, `src/components/UsersManagementView.tsx`):**
  - `TRANSFER_AND_DELETE_USER` perkelia aktyvų turtą, skyrių/kabinetų atsakomybę bei vykdomas (`in_progress`) inventorizacijas, bet nekeičia jau užbaigtų (`completed`) inventorizacijų istorinio komisijos pirmininko.
  - `DELETE_USER` leidžia pašalinti darbuotoją, jei jam priskirtos tik jau užbaigtos inventorizacijos, išsaugodamas istorinę pirmininko momentinę kopiją.

### 4 etapas – Inventorizacija ir QR (Atlikta)
- **QR turinio suderinamumas ir dekodavimas (`src/utils/qrUtils.ts`, `src/components/LabelsQRView.tsx`, `src/utils/brotherPrinter.ts`):**
  - Etikečių spausdinimas ir QR skaitytuvas naudoja bendrą `buildItemQrPayload` / `resolveScannedInventoryItem` formatą (`{ inv, name, school }`).
  - Palaikomi visi įvesties variantai: programos JSON QR kodai, CSV eksporto eilutės (`INV | Pavadinimas | Mokykla`), paprastas inventorinis numeris, serijos numeris, brūkšninis kodas ir vidinis ID.
  - Sugadintas JSON ar nežinomas kodas niekada nesukelia programos klaidos ir pateikia aiškų lietuvišką pranešimą.
- **Realus telefono kameros QR skaitytuvas (`src/components/AuditCameraScanner.tsx`):**
  - Naudojama `jsqr` (ir `BarcodeDetector` jei palaiko naršyklė) per `navigator.mediaDevices.getUserMedia` su galinės kameros pirmenybe (`facingMode: { ideal: 'environment' }`) ir kameros perjungikliu, kai įrenginyje yra kelios kameros.
  - Apdorojamos leidimų atmetimo, nerastos kameros, užimtos kameros ir nesaugaus ryšio (`HTTPS`) klaidos su aiškiomis lietuviškomis instrukcijomis.
  - Garantinis kameros srauto ir `requestAnimationFrame` sustabdymas uždarius skaitytuvą ar išėjus iš ekrano (`useEffect` cleanup).
  - Apsauga nuo pakartotinių to paties kodo skenavimų (2,5 s pauzė) ir nuo lygiagrečių mutacijų lenktynių (`scanInFlightRef`).
- **Inventorizacijos sesijų gyvavimo ciklas ir momentinis sąrašas (`src/utils/auditUtils.ts`, `src/utils/dbOperations.ts`, `src/components/AuditView.tsx`, `src/components/DashboardView.tsx`):**
  - Galimybė sukurti naują atskirą sesiją (`CREATE_AUDIT_SESSION`) pasirinkus apimtį (visi skyriai arba konkretus skyrius, remontuojamo / nurašomo turto įtraukimas; **`written_off` turtas pagal nutylėjimą visada neįtraukiamas**).
  - Nauja sesija pradedama švariai be senų patikrinimų žymėjimų, o sesijos pradžioje užfiksuojamas momentinis sąrašas (`snapshotItems`).
  - Aiškiai atskirta **„Dar nepatikrinta“** (`unchecked`) nuo **„Trūksta“** (`missing`), fiksuojama kas, kada, kur ir kokiu būdu (`qr`, `barcode`, `manual_code`, `manual_list`) patikrino daiktą, ir atnaujinama daikto `lastAuditDate`.
  - Kitame kabinete rasto turto fiksavimas (`found_elsewhere`) automatiškai nekeičia jo oficialios registro vietos – komisijai pateikiami du aiškūs veiksmai: užfiksuoti faktinę vietą čia arba oficialiai perkelti su judėjimo aktu (`RELOCATE_AUDIT_ITEM`).
  - Užbaigiant sesiją (`COMPLETE_AUDIT_SESSION`) rodomas patvirtinimo langas su santrauka; užbaigta sesija užrakinama nuo tylių pakeitimų, o vėlesni registro pakeitimai ar pervadinimai neperrašo užbaigtos sesijos apyrašo rezultatų.
  - Kiekvienas patikrinimas siunčiamas atomine operacija (`RECORD_AUDIT_CHECK`) su daikto lygio raktu `audit_check:<sessionId>:<itemId>`, todėl keli lygiagrečiai skenuojantys komisijos nariai neperrašo vienas kito rezultatų.
  - Tuščia bazė, tuščias sesijų sąrašas ar 0 daiktų sesija saugiai atvaizduojama be klaidų ir be `NaN%`.
- **Suderinamumas su senomis JSON kopijomis (`src/utils/databaseValidation.ts`):**
  - Senos `1.0.0` / `1.1.0` kopijos be `snapshotItems` ir `checkRecords` importuojamos ir peržiūrimos be klaidų, neišgalvojant nesančių istorinių laikų ar autorių.
- **Papildomi 4 etapo pataisymai pagal peržiūrą (versija `57b5055`):**
  - **Papildomų radinių momentinė istorija (`src/types/inventory.ts`, `src/utils/auditUtils.ts`, `src/utils/dbOperations.ts`, `src/utils/databaseValidation.ts`, `src/components/AuditView.tsx`):** papildomo radinio patikros / perkėlimo metu išsaugomas `itemSnapshot` (pavadinimas, kainos, atsakingas asmuo, skyrius, Inv. Nr., SN). Užbaigtoje sesijoje papildomų radinių duomenys visada imami tik iš `itemSnapshot`, todėl vėlesnis registro keitimas ar trynimas nekeičia užbaigto apyrašo; senoms sesijoms trūkstama istorija neišgalvojama ir pažymima `hasIncompleteHistory`. Apyrašo A4 modalas ir užbaigimo suvestinė aiškiai atskiria pradinės apimties sąrašą nuo papildomų radinių (`additionalFindingsCount`); JSON eksportas/importas išsaugo naujus laukus (papildomos duomenų migracijos nereikia, nauji laukai neprivalomi).
  - **Nuoseklios apimties taisyklės (`src/utils/auditUtils.ts`, `src/utils/dbOperations.ts`, `src/components/AuditView.tsx`, `src/App.tsx`):** `RECORD_AUDIT_CHECK`, `MARK_AUDIT_ITEM_MISSING`, `RELOCATE_AUDIT_ITEM` ir UI skeneris nuosekliai naudoja `evaluateItemAuditScope`. Pradiniame `snapshotItems` sąraše buvęs turtas išlieka istorinėje apimtyje net vėliau pakeitus jo būseną; sąmoningai neįtraukto statuso (`in_repair`, `to_writeoff`) turtas be aiškaus vartotojo išimties patvirtinimo (`confirmExcludedStatus: true`) atmetamas su HTTP `400` ir niekada neįtraukiamas tyliai.
  - **Kameros asinchroninio paleidimo ir uždarymo valdymas (`src/utils/cameraController.ts`, `src/components/AuditCameraScanner.tsx`):** įdiegtas monotoninis `runId` valdiklis su aiškia gyvavimo ciklo kontrole (`start`/`stop`/`switchCamera`), todėl pavėluotas `getUserMedia` srautas ar klaida sustabdo tik savo pasenusį srautą ir niekada neperrašo naujesnės kameros būsenos; `enumerateDevices` nebesukelia perteklinio pakartotinio paleidimo; uždarius ar išmontavus kamerą sustabdomas srautas, `requestAnimationFrame` ir ignoruojami pavėluoti asinchroninio dekodavimo (`BarcodeDetector.detect`) rezultatai. (Fizinė mobiliojo telefono kamera realiame įrenginyje netestuota – patikrinta automatizuotais testais su imituotais `MediaStream`/`getUserMedia` objektais.)

### Patikrų rezultatai
- `tests/stage1-storage.test.ts`, `tests/stage2-editing-relations.test.ts`, `tests/stage3-writeoff-restore.test.ts`, `tests/stage3-queue-and-history.test.ts`, `tests/stage4-audit-qr.test.ts` – vykdomi su `npx tsx --test`.

---

## Likę etapai

- 5 – ataskaitos ir suvestinės
- 6 – gedimai, etiketės ir darbuotojų importas
- 7 – diegimas ir galutinė patikra
