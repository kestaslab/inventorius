import React from 'react';
import { 
  LayoutDashboard, 
  Boxes, 
  Building2, 
  ArrowLeftRight, 
  QrCode, 
  FileText, 
  Server, 
  ShieldCheck,
  School,
  Users,
  LogIn
} from 'lucide-react';
import { User } from '../types/inventory';

export type NavigationTab = 
  | 'dashboard' 
  | 'inventory' 
  | 'departments' 
  | 'movements' 
  | 'audit' 
  | 'labels' 
  | 'reports' 
  | 'users'
  | 'selfhost';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  currentUser: User;
  allUsers: User[];
  onChangeUser: (userId: string) => void;
  itemsCount: number;
  onOpenLoginModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  currentUser,
  allUsers,
  onChangeUser,
  itemsCount,
  onOpenLoginModal,
}) => {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';

  const allNavItems: { id: NavigationTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string | number }[] = [
    { id: 'dashboard', label: 'Suvestinė', icon: LayoutDashboard },
    { id: 'inventory', label: 'Inventoriaus sąrašas', icon: Boxes, badge: itemsCount },
    { id: 'departments', label: 'Skyriai ir kabinetai', icon: Building2 },
    { id: 'movements', label: 'Perkėlimo žurnalas', icon: ArrowLeftRight },
    { id: 'audit', label: 'Inventorizacija (QR)', icon: QrCode },
    { id: 'labels', label: 'QR kodai ir etiketės', icon: QrCode },
    { id: 'reports', label: 'Ataskaitos ir aktai', icon: FileText },
    { id: 'users', label: 'Vartotojai ir teisės', icon: Users, badge: allUsers.length },
    { id: 'selfhost', label: 'Proxmox & Saugykla', icon: Server },
  ];

  const navItems = allNavItems.filter((item) => {
    if (item.id === 'users' || item.id === 'selfhost') {
      return isPrivileged;
    }
    return true;
  });

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0 min-h-screen border-r border-slate-800 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-white p-1 flex items-center justify-center shrink-0 border border-slate-700 shadow-sm overflow-hidden">
            <img 
              src="/assets/aistudio/__05425c32.jpg" 
              alt="Tryškių Lazdynų Pelėdos gimnazijos logotipas" 
              className="w-full h-full object-contain"
            />
          </div>
          <div className="overflow-hidden min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-white truncate">
              Gimnazijos Inventorius
            </h1>
            <p className="text-xs text-slate-400 truncate" title="Telšių raj. Tryškių Lazdynų Pelėdos gimnazija">
              Tryškių Lazdynų Pelėdos gimn.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-slate-400 uppercase">
          Valdymas
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left ${
                isActive
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span
                  className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded text-xs ${
                    isActive ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Role / User Profile & Auth Switcher */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/70 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-semibold truncate max-w-[120px]">{currentUser.fullName}</span>
          </div>
          <span className="text-[9px] font-mono uppercase bg-slate-800 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
            {currentUser.role}
          </span>
        </div>

        <select
          value={currentUser.id}
          onChange={(e) => onChangeUser(e.target.value)}
          title="Greitas darbuotojų perjungimas (testavimui)"
          className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
        >
          {allUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName} ({user.roleTitle})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onOpenLoginModal}
          className="w-full py-1.5 px-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/30 rounded-md text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Prisijungti / Gmail patikra</span>
        </button>

        <div className="pt-1 px-1 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/80">
          <span>Proxmox LXC</span>
          <span className="text-emerald-400 font-mono">Baltasis sąrašas aktyvus</span>
        </div>
      </div>
    </aside>
  );
};
