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

### Patikrų rezultatai
- `tests/stage1-storage.test.ts`, `tests/stage2-editing-relations.test.ts`, `tests/stage3-writeoff-restore.test.ts`, `tests/stage3-queue-and-history.test.ts` – vykdomi su `npx tsx --test`.

---

## Likę etapai

- 4 – inventorizacija ir QR
- 5 – ataskaitos ir suvestinės
- 6 – gedimai, etiketės ir darbuotojų importas
- 7 – diegimas ir galutinė patikra
