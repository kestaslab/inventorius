import { Plus, Download, LogOut, Cloud, CloudOff, Loader2, RefreshCw, AlertTriangle, Eye } from 'lucide-react';
import { User } from '../types/inventory';
import { SyncState } from '../utils/storage';
import { NavigationTab } from './Sidebar';

interface HeaderProps {
  currentTab: NavigationTab;
  currentUser: User;
  onOpenAddItem: () => void;
  onExportCSV: () => void;
  onOpenLoginModal: () => void;
  onLogout?: () => void;
  syncState?: SyncState;
  onRetrySync?: () => void;
  onReloadFromServer?: () => void;
  onExitLocalPreview?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  currentUser,
  onOpenAddItem,
  onExportCSV,
  onOpenLoginModal,
  onLogout,
  syncState,
  onRetrySync,
  onReloadFromServer,
  onExitLocalPreview,
}) => {
  const getTabTitle = (tab: NavigationTab): { title: string; subtitle: string } => {
    switch (tab) {
      case 'dashboard':
        return { title: 'Bendra suvestinė', subtitle: 'Mokyklos turto ir materialinių vertybių apžvalga' };
      case 'my_inventory':
        return { title: 'Mano priskirtas inventorius', subtitle: 'Jūsų materialinei atsakomybei ir kabinetams priskirtas turtas bei gedimų registravimas' };
      case 'inventory':
        return { title: 'Inventoriaus registras', subtitle: 'Viso materialiojo turto sąrašas su filtrais ir būsenomis' };
      case 'departments':
        return { title: 'Skyriai ir kabinetai', subtitle: 'Struktūriniai padaliniai, patalpos ir kabinetų vedėjai' };
      case 'movements':
        return { title: 'Turto perkėlimo žurnalas', subtitle: 'Judėjimas tarp kabinetų ir perdavimo-priėmimo aktai' };
      case 'audit':
        return { title: 'Metinė inventorizacija', subtitle: 'Faktinės patikros vykdymas, QR skenavimas ir neatitikimai' };
      case 'labels':
        return { title: 'QR kodų ir 36mm etikečių generatorius', subtitle: 'Kompaktiškos etiketės 36mm juostelių spausdintuvams ir Word eksportas' };
      case 'reports':
        return { title: 'Oficialios ataskaitos ir aktai', subtitle: 'Dokumentų formavimas ir atsisiuntimas DOCX bei Excel formatais' };
      case 'users':
        return { title: 'Naudotojai ir prieigos teisės', subtitle: 'Paskyrų valdymas, Gmail baltojo sąrašo nustatymai ir rolės' };
      case 'selfhost':
        return currentUser.role === 'admin'
          ? { title: 'Proxmox VE serveris ir atsarginės kopijos', subtitle: 'Konteinerio priežiūra, terminalo komandos ir pilnas duomenų eksportas' }
          : { title: 'Inventoriaus atsarginės kopijos', subtitle: 'Mokyklos duomenų bazės eksportas ir saugus archyvavimas JSON formatu' };
    }
  };

  const { title, subtitle } = getTabTitle(currentTab);
  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  const renderSyncBadge = () => {
    if (!syncState) return null;

    if (syncState.localPreviewMode || syncState.status === 'local_preview') {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold">
          <Eye className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="hidden md:inline">Vietinė demonstracinė peržiūra</span>
          <span className="md:hidden">Peržiūra</span>
          {onExitLocalPreview && (
            <button
              type="button"
              onClick={onExitLocalPreview}
              className="ml-1 px-1.5 py-0.5 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-950 font-bold cursor-pointer transition-colors"
            >
              Grįžti į serverį
            </button>
          )}
        </div>
      );
    }

    if (syncState.status === 'loading') {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="hidden lg:inline">Kraunama iš serverio...</span>
        </div>
      );
    }

    if (syncState.status === 'saving') {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
          <span>Išsaugoma...</span>
        </div>
      );
    }

    if (syncState.status === 'conflict') {
      return (
        <div
          title={syncState.errorMessage || 'Aptiktas duomenų konfliktas'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Konfliktas</span>
          {onReloadFromServer && (
            <button
              type="button"
              onClick={onReloadFromServer}
              className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Atnaujinti</span>
            </button>
          )}
        </div>
      );
    }

    if (syncState.status === 'error') {
      return (
        <div
          title={syncState.errorMessage || 'Nepavyko išsaugoti duomenų serveryje'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 text-[11px] font-semibold"
        >
          <CloudOff className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>Nepavyko išsaugoti</span>
          {syncState.pendingCount > 0 && (
            <span className="px-1 rounded bg-rose-200 text-rose-900 font-mono text-[10px]">
              {syncState.pendingCount}
            </span>
          )}
          {onRetrySync && (
            <button
              type="button"
              onClick={onRetrySync}
              className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Kartoti</span>
            </button>
          )}
        </div>
      );
    }

    if (syncState.status === 'uninitialized') {
      return (
        <div
          title={syncState.errorMessage || 'Serverio duomenų bazė dar tuščia'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="hidden md:inline">Serverio DB neinicijuota</span>
        </div>
      );
    }

    return (
      <div
        title={`Serverio duomenų bazės versija: v${syncState.revision}${
          syncState.lastSavedAt ? ` · Paskutinis sinchronizavimas: ${new Date(syncState.lastSavedAt).toLocaleTimeString('lt-LT')}` : ''
        }`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold"
      >
        <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="hidden sm:inline">Išsaugota serveryje</span>
        {syncState.revision > 0 && (
          <span className="hidden xl:inline text-[10px] font-mono text-emerald-700/80">
            v{syncState.revision}
          </span>
        )}
      </div>
    );
  };

  return (
    <header className="h-16 bg-white border-b border-slate-300 px-6 flex items-center justify-between gap-4 shrink-0 shadow-2xs no-print">
      {/* Zone 1: Context Title and Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-md bg-white border border-slate-300 p-0.5 shadow-2xs shrink-0 hidden sm:flex items-center justify-center">
          <img 
            src="/assets/aistudio/__05425c32.jpg" 
            alt="Tryškių Lazdynų Pelėdos herbas" 
            className="w-full h-full object-contain"
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span title="Telšių raj. Tryškių Lazdynų Pelėdos gimnazija" className="truncate font-semibold text-slate-700">
              Tryškių Lazdynų Pelėdos gimnazija
            </span>
            <span aria-hidden="true" className="text-slate-400">/</span>
            <span className="text-slate-900 font-bold truncate">{title}</span>
          </div>
          <p className="text-xs text-slate-500 truncate mt-0.5 font-medium">{subtitle}</p>
        </div>
      </div>

      {/* Zone 2: Sync Status & Action Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {renderSyncBadge()}

        {canManage && (
          <button
            onClick={onExportCSV}
            title="Atsisiųsti inventoriaus duomenis į Excel (CSV formatu)"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all whitespace-nowrap cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden lg:inline">Atsisiųsti Excel</span>
          </button>
        )}

        {canManage && (
          <button
            onClick={onOpenAddItem}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-sm whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>Registruoti turtą</span>
          </button>
        )}

        {onLogout && (
          <button
            onClick={onLogout}
            title={`Atsijungti iš ${currentUser.fullName} paskyros`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-all whitespace-nowrap cursor-pointer shadow-2xs"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Atsijungti</span>
          </button>
        )}
      </div>
    </header>
  );
};
