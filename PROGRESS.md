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

### 5 etapas – Ataskaitos ir suvestinės (Atlikta)
- **Ataskaitų duomenų teisingumas (`src/utils/reportUtils.ts`, `src/components/ReportsView.tsx`):**
  - Fizinės inventorizacijos apyrašas (`buildAuditSessionReportData`) griežtai atskirtas nuo dabartinio turto registro sąrašo (`buildRegistrySheetReportData`).
  - Inventorizacijos ataskaitoje leidžiama pasirinkti sesiją; naudojami jos `snapshotItems` ir `checkRecords` (įskaitant papildomų radinių `itemSnapshot`).
  - Tiksliai atvaizduojamos būsenos „Rastas vietoje“, „Rastas kitur (...)“, „Trūksta“ ir „Dar nepatikrinta“ – niekada nerodoma „Yra“ nepatikrintiems ar vien registro įrašams.
  - Papildomi radiniai pateikiami atskiroje dalyje nuo pradinės sesijos apimties.
  - Užbaigta inventorizacijos sesija ir patvirtintas nurašymo aktas išlieka nekintami vėliau redagavus ar ištrynus registro daiktus arba pakeitus įstaigos rekvizitus; senoms sesijoms/aktams be momentinės istorijos neišgalvojami duomenys ir rodomas aiškus įspėjimas apie ribotus istorinius duomenis.
  - Peržiūra, spausdinimas, CSV ir DOCX eksportas naudoja vieną ir tą patį suvestą duomenų rinkinį (`ResolvedReportData`); esant tuščiam rezultatui rodoma aiški tuščia būsena, o spausdinimas ir eksportai išjungiami.
- **Dokumentų rekvizitai (`src/types/inventory.ts`, `src/utils/organization.ts`, `src/utils/dbOperations.ts`, `src/components/ReportsView.tsx`, `src/App.tsx`):**
  - Pašalinti visi priverstinai įrašyti dokumentų metai (`2026`), numeriai (`INV-2026/01`) ir išgalvotos komisijos pavardės iš ataskaitų bei nurašymo fallback kodo (`App.tsx`).
  - Pridėti redaguojami įstaigos rekvizitai (`OrganizationSettings`, ištaisyta klaida `LAZDYNYŲ` -> `Lazdynų`, kodas `190558117`), išsaugomi per `UPDATE_ORGANIZATION_SETTINGS` mutaciją ir užšaldomi (`organizationSnapshot`) užbaigtose sesijose bei patvirtintuose nurašymo aktuose.
  - Senos JSON kopijos be `organizationSettings` saugiai migruojamos su numatytaisiais įstaigos rekvizitais (`databaseValidation.ts`), neliečiant istorinių dokumentų momentinės istorijos.
- **Tikras OOXML DOCX ir tvarkingas CSV (`src/utils/docxExport.ts`, `src/utils/csvUtils.ts`, `src/utils/storage.ts`):**
  - Vietoj HTML `.doc` surogato sukurtas tikras `.docx` dokumentų generatorius su `docx` biblioteka (`Packer.toBlob` / `Packer.toBuffer`), pasikartojančiomis lentelių antraštėmis, `cantSplit` eilutėmis bei parašų blokais ir saugiu XML specialiųjų simbolių bei lietuviškų raidžių koduotės apdorojimu.
  - Suvienodintas CSV eksportas (`buildCsvContent`, `encodeCsvField`) su UTF-8 BOM (`\uFEFF`), `;` skirtuku, `\r\n` eilučių pabaigomis, kabučių/naujų eilučių ekranavimu ir lietuvišku kableliniu pinigų formatavimu tiek ataskaitose, tiek `StorageService.exportToCSV`.
- **Suvestinių, pinigų, datų ir filtrų nuoseklumas (`src/utils/accountingUtils.ts`, `src/utils/dateUtils.ts`, `src/components/DashboardView.tsx`, `src/components/InventoryListView.tsx`, `src/components/ItemModal.tsx`, `src/components/WriteOffModal.tsx`, `src/utils/writeOffUtils.ts`):**
  - Suvienodinta IMT/TMT klasifikacija (`resolveAssetClass`: prioritetas `assetClass`, fallback `750 €`) ir bendra nenurašyto turto suvestinė (`computeInventorySummary`) tarp `DashboardView` ir `ReportsView`.
  - Piniginės sumos skaičiuojamos sveikais centais (`toCents`, `sumMoney`, `fromCents`), o trūkstamos likutinės vertės skaičiuojamos skaidriai (`summarizeResidualValues`), niekada neprilyginant jų patvirtintam `0.00 €`.
  - Kalendorinės `YYYY-MM-DD` datos ir laikai tvarkomi per `Europe/Vilnius` laiko juostos funkcijas (`dateUtils.ts`) be UTC paros poslinkio klaidų.
- **A4 spausdinimo stiliai (`src/index.css`, `src/components/Sidebar.tsx`, `src/components/ReportsView.tsx`, `src/components/AuditView.tsx`, `src/components/MovementsView.tsx`):**
  - Pritaikytos `@media print` A4 taisyklės, panaikinančios ekrano `h-screen overflow-hidden` ir modalų `max-h-[94vh]` apkarpymą, paslepiančios navigaciją/mygtukus/foninius elementus ir įgalinančios daugiapuslapį lentelių spausdinimą su pasikartojančiu `thead`. (Fizinis / naršyklės spausdinimo dialogo vaizdas nebuvo vizualiai tikrinamas, nes aplinkoje nėra įdiegto Chromium/Playwright.)

### 6 etapas – Gedimai, etiketės ir darbuotojų importas (Atlikta)
- **Gedimų ir remonto gyvavimo ciklas (`src/types/inventory.ts`, `src/utils/defectUtils.ts`, `src/utils/dbOperations.ts`, `src/utils/databaseValidation.ts`, `src/components/ReportFaultModal.tsx`, `src/components/ItemDetailModal.tsx`, `src/components/InventoryListView.tsx`, `src/App.tsx`):**
  - Griežtai atskirtos būsenos `Pranešta` (`reported`), `Remontuojamas` (`in_repair`) ir `Išspręsta` (`resolved`).
  - Naujo gedimo registravimas (`SAVE_FAULT_REPORT`) neperjungia turto būsenos į `in_repair`, neblogina būklės (`condition`) ir neteršia bendrų pastabų (`notes`).
  - Pridėtos serverio operacijos `START_DEFECT_REPAIR` (užfiksuoja pradėjusį asmenį, datą, pastabas) ir `RESOLVE_DEFECT` (reikalauja privalomų sprendimo pastabų, išsaugo išsprendusį asmenį ir laiką).
  - Išsaugoma visa gedimų istorija (`defectReports`); išspręsti gedimai neskaičiuojami kaip aktyvūs (`getActiveDefects`). Turint kelis gedimus, vieno užbaigimas neišvalo kitų aktyvių gedimų ir grąžina daiktą į `active` tik tada, kai nelieka nei vieno aktyvaus gedimo.
  - Nurašymo ir archyvo būsenos (`to_writeoff`, `written_off`) turi griežtą pirmenybę: gedimo pranešimas ar sprendimas jų neperrašo į `in_repair` / `active`, o remonto pradžia tokiam turtui atmetama su `409 Conflict`.
  - Visi gedimų ir būsenų keitimai vykdomi serverio mutacijomis su revizijų apsauga (`409 Conflict` lygiagretaus darbo atveju).
- **„Mano inventorius“ ir šoninės juostos nuoseklumas (`src/utils/defectUtils.ts`, `src/components/MyInventoryView.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`):**
  - Bendroje `getMyInventorySummary` / `isItemAssignedToUserScope` funkcijoje suvienodintas priskyrimas pagal asmeninę atsakomybę, `assignedRoomId`/`assignedRoomIds` ir `defaultResponsiblePersonId`.
  - Šoninės juostos skaitiklis (`myItemsCount`) tiksliai atitinka „Mano inventoriaus“ numatytąjį aktyvių daiktų sąrašą; nurašyti (`written_off`) daiktai pagal nutylėjimą atskirti už atskiro perjungiklio, o išspręsti gedimai neberodomi prie aktyvių įspėjimų.
- **Etiketės ir spausdinimo eiga (`src/utils/labelUtils.ts`, `src/utils/brotherPrinter.ts`, `src/utils/docxExport.ts`, `src/components/LabelsQRView.tsx`, `src/components/ItemDetailModal.tsx`, `src/components/InventoryListView.tsx`):**
  - Palaikomi visi trys kodų režimai (`qr_code`, `barcode_1d`, `both`) tiek spausdinime, tiek peržiūroje, tiek OOXML `.docx` eksporte.
  - QR kodų generavimas suvienodintas su `buildItemQrPayload` (`{ inv, name, school }`) – visi etikečių QR ir 1D brūkšniniai kodai atpažįstami `resolveScannedInventoryItem` skaitytuve.
  - Realizuotas laukimas `waitForPrintDocumentReady` prieš `print()`, pašalintas aklas `1000 ms` laikmatis bei automatinis žymėjimas uždarius langą ar įvykus klaidai – etiketė pažymima paženklinta (`confirmLabelApplied`) TIK gavus aiškų naudotojo patvirtinimą.
  - `preSelectedIds` iš registro griežtai riboja atrenkamą sąrašą be tylių papildymų; QR podėlio raktas `getLabelCacheKey` automatiškai atsinaujina pakeitus daikto duomenis; ištaisyta klaida `LAZDYNYŲ` -> `Lazdynų`.
  - Tikras OOXML `.docx` etikečių dokumentas su įterptais PNG QR/Code128 paveikslėliais (`generateLabelsDocxBlob` / `generateLabelsDocxBuffer`) ir UTF-8 BOM CSV per `buildCsvContent`.
  - *(Pastaba: gyvas naršyklės spausdinimo dialogo vizualinis vaizdas ir fizinis Brother PT-E920BT spausdintuvo darbas šioje aplinkoje netikrinti dėl naršyklės ir spausdintuvo aparatūros nebuvimo – automatizuotai patikrintas HTML/SVG/PNG/OOXML `.docx` ir QR/1D kodavimo suderinamumas.)*
- **Darbuotojų CSV importas (`src/utils/userCsvImport.ts`, `src/utils/dbOperations.ts`, `src/components/UsersManagementView.tsx`, `src/App.tsx`):**
  - Sukurtas pilnas RFC-4180 CSV analizatorius (`parseCsvMatrix`) su UTF-8 BOM, lietuviškomis raidėmis, kabučių ekranavimu (`""`) ir naujomis eilutėmis / skirtukais kabutėse.
  - Dviejų žingsnių importo peržiūra (`analyzeUsersCsvImport` -> `buildFinalBatchUsersFromPreview`): atskiriami nauji įrašai, atnaujinimai su laukų pokyčiais, praleidžiamos dublikatų/kolizijų eilutės ir dviprasmiški atvejai (pvz., keli kabinetai su tuo pačiu numeriu skirtinguose skyriuose niekada automatiškai neparenkami).
  - Tušti ar praleisti CSV langeliai išsaugo esamus darbuotojo duomenis ir `assignedRoomIds`; palaikomi keli kabinetai; atnaujinant paštą tikrinama be raidžių registro skirtumo; archyvuoti darbuotojai išlieka archyvuoti ir neaktyvūs.
  - Masinis importas (`BATCH_IMPORT_USERS`) serveryje yra atominis („viskas arba nieko“) ir **niekada** nekeičia esamų naudotojų `role`, `pinCode`, `isActive` ar `isArchived` laukų (palikta aiški saugumo pastaba dėl ignoruojamų `Rolė`/`PIN` stulpelių).

### 7 etapas – Diegimas ir galutinė patikra (Atlikta paruošimo apimtis)
- **Nuoseklus paketų valdymas ir serverio paleidimas (`Dockerfile`, `docker-compose.yml`, `package.json`, `bun.lock`, `server.ts`, `update.sh`, `.env.example`, `.gitignore`):**
  - Visi diegimo ir atnaujinimo būdai suvienodinti ant **`bun`** ir **`bun.lock`** (`bun install --frozen-lockfile --dry-run` patikrintas sėkmingai). `tsx` perkeltas į `dependencies`, todėl produkcinė aplinka paleidžia `server.ts` be `devDependencies`.
  - `Dockerfile` perrašytas į daugiapakopį vaizdą su `bun` ir `server.ts` (`DATA_DIR=/app/data`, produkcinis `dist/` + `/api/*`), `docker-compose.yml` pašalintas pasenęs `version: '3.8'`, įrašytas vieno proceso ribojimas (`replicas: 1`) dėl `withDbLock` atmintyje ir `/api/health` tikrinimas.
  - `server.ts` papildytas konfigūruojamu `DATA_DIR`, JSON `404` gaudykle visiems nežinomiems `/api/*` maršrutams (kad niekada negrąžintų SPA HTML), `dist/index.html` patikra produkcijos režime ir tvarkingu stabdymu (`SIGINT`/`SIGTERM`).
  - `/api/health` (`src/server/databaseApi.ts`) tikrina `DATA_DIR` skaitymo/rašymo teises, `school_database.json` sintaksę ir schemos versiją (sugadintam JSON ar naujesnei versijai grąžina HTTP `503`).
- **Saugus atnaujinimas, atsarginės kopijos ir atkūrimas (`scripts/db-cli.ts`, `scripts/backup-data.sh`, `scripts/restore-data.sh`, `PROXMOX_DIEGIMAS.md`, `src/components/SelfHostView.tsx`):**
  - Pakeistas `update.sh`: pašalinti destruktyvūs `git reset --hard`, `git clean -fd` bei klaidinantis slaptažodžio pranešimas; prieš atnaujinimą patikrinami neužfiksuoti pakeitimai, sukuriama pilna kopija, vykdomas `git pull --ff-only`, `bun install --frozen-lockfile`, `bun run build`, perkraunamas vienas PM2 procesas (`-i 1`) ir patikrinamas `/api/health`.
  - Sukurti izoliuoti skriptai `scripts/backup-data.sh` (sukuria nešiojamą JSON kopiją su nuotraukomis ir `.tar.gz` katalogo archyvą) ir `scripts/restore-data.sh` (validuoja kopiją laikiname kataloge, sukuria saugos archyvą `pre_restore_*.tar.gz` ir atkuria `school_database.json` bei `photos/`).
  - `SelfHostView.tsx` ir `PROXMOX_DIEGIMAS.md` suderinti su `bun`, `server.ts`, `DATA_DIR`, vieno proceso reikalavimu bei aiškiai atskirtos `data/backups/` (be `photos/`) ir pilnos išorinės kopijos.
- **Senų kopijų `organizationSettings` klaidos pataisa (`src/utils/organization.ts`, `src/utils/databaseValidation.ts`, `src/utils/dbOperations.ts`, `src/utils/storage.ts`, `src/utils/reportUtils.ts`, `src/utils/docxExport.ts`, `src/components/ReportsView.tsx`, `src/components/LabelsQRView.tsx`, `src/App.tsx`):**
  - Importuojant seną JSON kopiją be `organizationSettings`, rekvizitai nebepriskiriami automatiškai kaip patvirtinti (`organizationSettings` lieka `undefined`, pateikiamas įspėjimas `warnings[]`).
  - Kol įstaigos rekvizitai nepatvirtinti, oficialių ataskaitų ir etikečių `.docx` / spausdinimo / CSV eksportai blokuojami su aiškiu įspėjimu ir galimybe įstaigai patiems patvirtinti rekvizitus skiltyje „Ataskaitos ir aktai“; istorinės užbaigtos sesijos ir patvirtinti aktai nekeičiami.
- **Suderinamumas su senomis Proxmox DB nuorodomis ir PM2 + `bun` paleidimu (`src/utils/databaseValidation.ts`, `src/utils/dbOperations.ts`, `scripts/backup-data.sh`, `update.sh`, `PROXMOX_DIEGIMAS.md`, `src/components/SelfHostView.tsx`):**
  - Jei senesnėje `school_database.json` kopijoje skyrius (`department.managerId`), kabinetas (`room.defaultResponsiblePersonId`), darbuotojas ar turto vienetas (`item.responsibleUserId`) nurodo prieš 2 etapą pašalintą įrašą (pvz. `usr-2`–`usr-5`), `validateAndMigrateDatabase` nebeblokiruoja visos bazės: pasenę pasirenkami ryšiai išvalomi, turtas išsaugomas nieko neišgalvojant, įrašomi aiškūs įspėjimai į `warnings[]`, o serveris prieš migraciją išsaugo `pre_migration` kopiją. Aktyvios mutacijos ir toliau griežtai tikrina nurodytų asmenų egzistavimą.
  - `extractInlinePhotosFromDb` / `saveDataUrlToDisk` (`src/server/databaseApi.ts`, `scripts/db-cli.ts`) papildyti `svg+xml`, `avif`, `bmp` ir papildomų MIME parametrų palaikymu bei saugiu atsarginiu elgesiu skaitant seną DB iš disko, kad vienas nestandartinis nuotraukos laukas negalėtų sukelti `500` klaidos `/api/database` ar `/api/database/backup` maršrutuose.
  - `update.sh`, `PROXMOX_DIEGIMAS.md` ir `SelfHostView.tsx` atnaujinti taip, kad PM2 paleistų `bun` su aiškiu `--interpreter none` parametru, po perkrovimo palauktų starto ir nepavykus `/api/health` išvestų `pm2 logs inventorius`.

### Patikrų rezultatai
- `npx tsx --test tests/stage*.test.ts` (`tests/stage1-storage.test.ts` .. `tests/stage7-deployment-e2e.test.ts`) – **52/52 testų sėkmingi** (įskaitant 7 izoliuotus 7 etapo testus: produkcinį `server.ts` subprocesą su perkrovimu, sugadintą/naujesnės schemos JSON su HTTP `503`, `backup-data.sh`/`restore-data.sh` bei `/api/database/backup` atkūrimą su nuotraukomis baitu į baitą, senos kopijos `organizationSettings` blokavimą, 1–6 etapų E2E ciklą, senos DB trūkstamų vartotojų nuorodų suderinamumą ir senų nuotraukų formatų migraciją).
- `bun install --frozen-lockfile --dry-run`, `bash -n update.sh scripts/backup-data.sh scripts/restore-data.sh`, `npm run build` (`vite build`) ir `npm run lint` (`tsc --noEmit`) – sėkmingi.

### Kas šioje aplinkoje NEPATIKRINTA (aiškios ribos)
- **Docker vaizdo kompiliacija ir konteinerio perkūrimas (`docker compose build` / `up`):** šioje aplinkoje nėra įdiegto `docker` CLI / Docker demono.
- **PM2 ir realus Proxmox LXC serveris:** `pm2` nėra įdiegtas šioje aplinkoje; produkcinis Proxmox LXC serveris sąmoningai neliestas.
- **Mobiliojo telefono kamera ir spausdintuvas Brother PT-E920BT:** telefono kameros praktinis bandymas atidėtas; fizinio Brother PT-E920BT spausdintuvo nėra (suderinamumas nepatvirtintas), gyvas naršyklės A4 spausdinimo vaizdas netikrintas.

---

## Likę etapai

- Visi 1–7 planiniai programavimo etapai baigti; laukiama naudotojo sprendimo dėl produkcinio diegimo Proxmox aplinkoje ir praktinių įrenginių (kameros / spausdintuvo) patikros.
