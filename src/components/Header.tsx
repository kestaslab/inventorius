import React from 'react';
import { Plus, Download } from 'lucide-react';
import { User } from '../types/inventory';
import { NavigationTab } from './Sidebar';

interface HeaderProps {
  currentTab: NavigationTab;
  currentUser: User;
  onOpenAddItem: () => void;
  onExportCSV: () => void;
  onOpenLoginModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  currentUser,
  onOpenAddItem,
  onExportCSV,
  onOpenLoginModal,
}) => {
  const getTabTitle = (tab: NavigationTab): { title: string; subtitle: string } => {
    switch (tab) {
      case 'dashboard':
        return { title: 'Bendra suvestinė', subtitle: 'Mokyklos turto ir materialinių vertybių apžvalga' };
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
        return { title: 'Savarankiškas diegimas (Proxmox / Docker)', subtitle: 'Konteinerio nustatymai, atsarginės kopijos ir duomenų bazė' };
    }
  };

  const { title, subtitle } = getTabTitle(currentTab);
  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  return (
    <header className="h-16 bg-white border-b border-slate-300 px-6 flex items-center justify-between gap-6 shrink-0 shadow-2xs no-print">
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

      {/* Zone 2: Action Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={onExportCSV}
          title="Atsisiųsti inventoriaus duomenis į Excel (CSV formatu)"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all whitespace-nowrap cursor-pointer shadow-xs"
        >
          <Download className="w-3.5 h-3.5 text-emerald-600" />
          <span>Atsisiųsti Excel</span>
        </button>

        {canManage && (
          <button
            onClick={onOpenAddItem}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-sm whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>Registruoti turtą</span>
          </button>
        )}
      </div>
    </header>
  );
};
