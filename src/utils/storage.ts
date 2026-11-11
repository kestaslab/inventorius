import { 
  Department, 
  Room, 
  User, 
  InventoryItem, 
  MovementRecord, 
  WriteOffAct, 
  AuditSession,
  AuthSettings 
} from '../types/inventory';
import { 
  INITIAL_DEPARTMENTS, 
  INITIAL_ROOMS, 
  INITIAL_USERS, 
  INITIAL_ITEMS, 
  INITIAL_MOVEMENTS, 
  INITIAL_WRITEOFF_ACTS,
  INITIAL_AUDIT_SESSION,
  INITIAL_AUTH_SETTINGS
} from '../data/initialData';

const STORAGE_KEYS = {
  DEPARTMENTS: 'school_inv_departments_v1',
  ROOMS: 'school_inv_rooms_v1',
  USERS: 'school_inv_users_v1',
  ITEMS: 'school_inv_items_v1',
  MOVEMENTS: 'school_inv_movements_v1',
  WRITEOFFS: 'school_inv_writeoffs_v1',
  AUDIT_SESSIONS: 'school_inv_audits_v1',
  ACTIVE_USER_ID: 'school_inv_active_user_v1',
  AUTH_SETTINGS: 'school_inv_auth_settings_v1',
};

export interface AppDatabase {
  version: string;
  exportedAt: string;
  departments: Department[];
  rooms: Room[];
  users: User[];
  items: InventoryItem[];
  movements: MovementRecord[];
  writeOffActs: WriteOffAct[];
  auditSessions: AuditSession[];
  authSettings?: AuthSettings;
}

const triggerImmediateServerSync = () => {
  StorageService.syncToServer().catch(err => console.warn('Server sync error:', err));
};


export const StorageService = {
  getDepartments(): Department[] {
    const raw = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(INITIAL_DEPARTMENTS));
      return INITIAL_DEPARTMENTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_DEPARTMENTS;
    }
  },

  saveDepartments(departments: Department[]) {
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(departments));
    triggerImmediateServerSync();
  },

  getRooms(): Room[] {
    const raw = localStorage.getItem(STORAGE_KEYS.ROOMS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(INITIAL_ROOMS));
      return INITIAL_ROOMS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_ROOMS;
    }
  },

  saveRooms(rooms: Room[]) {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
    triggerImmediateServerSync();
  },

  getUsers(): User[] {
    const raw = localStorage.getItem(STORAGE_KEYS.USERS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(INITIAL_USERS));
      return INITIAL_USERS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_USERS;
    }
  },

  saveUsers(users: User[]) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    triggerImmediateServerSync();
  },

  getItems(): InventoryItem[] {
    const raw = localStorage.getItem(STORAGE_KEYS.ITEMS);
    let items: InventoryItem[] = INITIAL_ITEMS;
    if (raw) {
      try {
        items = JSON.parse(raw);
      } catch {
        items = INITIAL_ITEMS;
      }
    } else {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(INITIAL_ITEMS));
      return INITIAL_ITEMS;
    }

    // Backward compatibility & migration:
    // 1. Rename category 'IT įranga' -> 'Kompiuteriai' (if computer) or 'Kita IT įranga'
    // 2. Map obsolete 'all_in_one' -> 'desktop'
    const migratedItems = items.map(item => {
      const initialMatch = INITIAL_ITEMS.find(i => i.id === item.id);
      let cat = item.category as any;
      if (cat === 'IT įranga') {
        if (initialMatch?.category && (initialMatch.category as string) !== 'IT įranga') {
          cat = initialMatch.category;
        } else if (
          item.specs?.computerType || 
          item.specs?.cpu || 
          item.name.toLowerCase().includes('kompiuter') || 
          item.name.toLowerCase().includes('thinkpad') || 
          item.name.toLowerCase().includes('serveris') || 
          item.name.toLowerCase().includes('ipad') || 
          item.name.toLowerCase().includes('planšet')
        ) {
          cat = 'Kompiuteriai';
        } else {
          cat = 'Kita IT įranga';
        }
      }

      let itemSpecs = item.specs || initialMatch?.specs;
      if (itemSpecs && (itemSpecs.computerType as any) === 'all_in_one') {
        itemSpecs = {
          ...itemSpecs,
          computerType: 'desktop',
        };
      }

      return {
        ...item,
        category: cat,
        assetClass: item.assetClass || (Number(item.purchasePrice) >= 750 ? 'long_term' : 'short_term'),
        fundingSource: item.fundingSource || 'school',
        specs: itemSpecs,
      };
    });

    return migratedItems;
  },

  saveItems(items: InventoryItem[]) {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
    triggerImmediateServerSync();
  },

  getMovements(): MovementRecord[] {
    const raw = localStorage.getItem(STORAGE_KEYS.MOVEMENTS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.MOVEMENTS, JSON.stringify(INITIAL_MOVEMENTS));
      return INITIAL_MOVEMENTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_MOVEMENTS;
    }
  },

  saveMovements(movements: MovementRecord[]) {
    localStorage.setItem(STORAGE_KEYS.MOVEMENTS, JSON.stringify(movements));
    triggerImmediateServerSync();
  },

  getWriteOffActs(): WriteOffAct[] {
    const raw = localStorage.getItem(STORAGE_KEYS.WRITEOFFS);
    let acts: WriteOffAct[] = INITIAL_WRITEOFF_ACTS;
    if (raw) {
      try {
        acts = JSON.parse(raw);
      } catch {
        acts = INITIAL_WRITEOFF_ACTS;
      }
    } else {
      localStorage.setItem(STORAGE_KEYS.WRITEOFFS, JSON.stringify(INITIAL_WRITEOFF_ACTS));
      return INITIAL_WRITEOFF_ACTS;
    }
    return acts;
  },

  saveWriteOffActs(acts: WriteOffAct[]) {
    localStorage.setItem(STORAGE_KEYS.WRITEOFFS, JSON.stringify(acts));
    triggerImmediateServerSync();
  },

  getAuditSessions(): AuditSession[] {
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_SESSIONS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.AUDIT_SESSIONS, JSON.stringify([INITIAL_AUDIT_SESSION]));
      return [INITIAL_AUDIT_SESSION];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [INITIAL_AUDIT_SESSION];
    }
  },

  saveAuditSessions(sessions: AuditSession[]) {
    localStorage.setItem(STORAGE_KEYS.AUDIT_SESSIONS, JSON.stringify(sessions));
    triggerImmediateServerSync();
  },

  getActiveUserId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID);
  },

  setActiveUserId(id: string) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, id);
  },

  clearActiveUserId() {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER_ID);
  },

  getAuthSettings(): AuthSettings {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_SETTINGS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.AUTH_SETTINGS, JSON.stringify(INITIAL_AUTH_SETTINGS));
      return INITIAL_AUTH_SETTINGS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_AUTH_SETTINGS;
    }
  },

  saveAuthSettings(settings: AuthSettings) {
    localStorage.setItem(STORAGE_KEYS.AUTH_SETTINGS, JSON.stringify(settings));
    triggerImmediateServerSync();
  },

  // Export full application state as JSON for Proxmox backup
  exportFullBackup(): string {
    const payload: AppDatabase = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      departments: this.getDepartments(),
      rooms: this.getRooms(),
      users: this.getUsers(),
      items: this.getItems(),
      movements: this.getMovements(),
      writeOffActs: this.getWriteOffActs(),
      auditSessions: this.getAuditSessions(),
      authSettings: this.getAuthSettings(),
    };
    return JSON.stringify(payload, null, 2);
  },

  // Central Proxmox Server Synchronization
  async syncToServer(): Promise<void> {
    try {
      const payload: AppDatabase = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        departments: this.getDepartments(),
        rooms: this.getRooms(),
        users: this.getUsers(),
        items: this.getItems(),
        movements: this.getMovements(),
        writeOffActs: this.getWriteOffActs(),
        auditSessions: this.getAuditSessions(),
        authSettings: this.getAuthSettings(),
      };
      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('Server sync offline or fallback mode', e);
    }
  },

  async loadFromServer(): Promise<boolean> {
    try {
      const res = await fetch('/api/database');
      if (!res.ok) return false;
      const data: AppDatabase | null = await res.json();
      if (!data) {
        // First run on new server: seed server database with current initial data
        await this.syncToServer();
        return false;
      }

      if (Array.isArray(data.departments)) localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(data.departments));
      if (Array.isArray(data.rooms)) localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(data.rooms));
      if (Array.isArray(data.users)) localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(data.users));
      if (Array.isArray(data.items)) localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(data.items));
      if (Array.isArray(data.movements)) localStorage.setItem(STORAGE_KEYS.MOVEMENTS, JSON.stringify(data.movements));
      if (Array.isArray(data.writeOffActs)) localStorage.setItem(STORAGE_KEYS.WRITEOFFS, JSON.stringify(data.writeOffActs));
      if (Array.isArray(data.auditSessions)) localStorage.setItem(STORAGE_KEYS.AUDIT_SESSIONS, JSON.stringify(data.auditSessions));
      if (data.authSettings) localStorage.setItem(STORAGE_KEYS.AUTH_SETTINGS, JSON.stringify(data.authSettings));

      return true;
    } catch (e) {
      console.warn('Could not load from /api/database, using local storage cache', e);
      return false;
    }
  },

  // Restore application state from backup JSON
  importFullBackup(jsonContent: string): boolean {
    try {
      const data: AppDatabase = JSON.parse(jsonContent);
      if (!Array.isArray(data.items) || !Array.isArray(data.departments)) {
        throw new Error('Neteisinga duomenų bazės struktūra');
      }
      if (data.departments) this.saveDepartments(data.departments);
      if (data.rooms) this.saveRooms(data.rooms);
      if (data.users) this.saveUsers(data.users);
      if (data.items) this.saveItems(data.items);
      if (data.movements) this.saveMovements(data.movements);
      if (data.writeOffActs) this.saveWriteOffActs(data.writeOffActs);
      if (data.auditSessions) this.saveAuditSessions(data.auditSessions);
      if (data.authSettings) this.saveAuthSettings(data.authSettings);
      return true;
    } catch (err) {
      console.error('Import failed', err);
      return false;
    }
  },

  // Reset to initial demo data
  resetToDefaults() {
    localStorage.removeItem(STORAGE_KEYS.DEPARTMENTS);
    localStorage.removeItem(STORAGE_KEYS.ROOMS);
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.ITEMS);
    localStorage.removeItem(STORAGE_KEYS.MOVEMENTS);
    localStorage.removeItem(STORAGE_KEYS.WRITEOFFS);
    localStorage.removeItem(STORAGE_KEYS.AUDIT_SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER_ID);
  },

  // Generate next automatic inventory number
  generateNextInventoryNumber(items: InventoryItem[]): string {
    const currentYear = new Date().getFullYear();
    const prefix = `TM-${currentYear}-`;
    const yearNumbers = items
      .map(i => i.inventoryNumber)
      .filter(num => num && num.startsWith(prefix))
      .map(num => parseInt(num.replace(prefix, ''), 10))
      .filter(n => !isNaN(n));

    const nextIndex = yearNumbers.length > 0 ? Math.max(...yearNumbers) + 1 : 1;
    return `${prefix}${nextIndex.toString().padStart(4, '0')}`;
  },

  // Export inventory to CSV format (compatible with Excel & Lithuanian locale)
  exportToCSV(items: InventoryItem[], departments: Department[], rooms: Room[], users: User[]): string {
    const header = [
      'Inventorinis numeris',
      'Pavadinimas',
      'Turto grupė (IMT/TMT)',
      'Turto kilmė (Panauda/Mokykla)',
      'Kategorija',
      'Serijos numeris',
      'Skyrius',
      'Kabinetas / Patalpa',
      'Atsakingas asmuo',
      'Įsigijimo data',
      'Įsigijimo kaina (€)',
      'Būsena',
      'Būklė',
      'IT Įrenginio tipas',
      'Procesorius (CPU)',
      'RAM (GB)',
      'Diskas (Storage)',
      'Operacinė sistema (OS)',
      'MAC adresas',
      'Pastabos'
    ].join(';');

    const rows = items.map(item => {
      const dept = departments.find(d => d.id === item.departmentId)?.name || '';
      const room = rooms.find(r => r.id === item.roomId);
      const roomStr = room ? `${room.number} ${room.name}` : '';
      const user = users.find(u => u.id === item.responsibleUserId)?.fullName || '';
      
      const assetClassStr = item.assetClass === 'long_term' || item.purchasePrice >= 750 
        ? 'Ilgalaikis (IMT ≥ 750 €)' 
        : 'Trumpalaikis / Mažavertis (< 750 €)';

      const fundingStr = 
        item.fundingSource === 'ministry' ? 'ŠMSM panauda' :
        item.fundingSource === 'municipality' ? 'Savivaldybės panauda' :
        item.fundingSource === 'project' ? 'ES / STEAM projektai' :
        item.fundingSource === 'donation' ? 'Kita' :
        'Gimnazijos lėšos';

      const statusLt = 
        item.status === 'active' ? 'Aktyvus' :
        item.status === 'in_repair' ? 'Remontuojamas' :
        item.status === 'to_writeoff' ? 'Teikiamas nurašyti' : 'Nurašytas';

      const conditionLt = 
        item.condition === 'new' ? 'Nauja' :
        item.condition === 'good' ? 'Gera' :
        item.condition === 'fair' ? 'Patenkinama' : 'Bloga';

      const compType = item.specs?.computerType 
        ? (item.specs.computerType === 'laptop' ? 'Nešiojamas' :
           item.specs.computerType === 'desktop' ? 'Stacionarus' :
           item.specs.computerType === 'server' ? 'Serveris' :
           item.specs.computerType === 'tablet' ? 'Planšetė' : 'Monoblokas')
        : '';

      return [
        `"${item.inventoryNumber}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${assetClassStr}"`,
        `"${fundingStr}"`,
        `"${item.category}"`,
        `"${item.serialNumber || ''}"`,
        `"${dept}"`,
        `"${roomStr}"`,
        `"${user}"`,
        `"${item.acquisitionDate}"`,
        item.purchasePrice.toFixed(2).replace('.', ','),
        `"${statusLt}"`,
        `"${conditionLt}"`,
        `"${compType}"`,
        `"${item.specs?.cpu || ''}"`,
        item.specs?.ramGb ? `${item.specs.ramGb}` : '',
        `"${item.specs?.storage || ''}"`,
        `"${item.specs?.os || ''}"`,
        `"${item.specs?.macAddress || ''}"`,
        `"${(item.notes || '').replace(/"/g, '""')}"`
      ].join(';');
    });

    return '\uFEFF' + [header, ...rows].join('\r\n'); // Add BOM for Excel UTF-8 support
  }
};
