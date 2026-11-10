import React, { useState } from 'react';
import { 
  KeyRound, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Lock,
  ArrowRight,
  Server,
  UserCheck
} from 'lucide-react';
import { User, AuthSettings } from '../types/inventory';

interface LoginPortalViewProps {
  users: User[];
  authSettings: AuthSettings;
  onLoginSuccess: (user: User) => void;
  onAccessDenied: (attemptedEmail: string) => void;
}

export const LoginPortalView: React.FC<LoginPortalViewProps> = ({
  users,
  authSettings,
  onLoginSuccess,
}) => {
  // Active available staff users
  const activeUsers = users.filter((u) => u.isActive !== false);

  const [selectedUserId, setSelectedUserId] = useState<string>(
    activeUsers[0]?.id || ''
  );
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successUser, setSuccessUser] = useState<User | null>(null);

  const selectedUser = users.find((u) => u.id === selectedUserId) || activeUsers[0];

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);

    if (!selectedUser) {
      setPinError('Pasirinkite darbuotoją iš sąrašo.');
      return;
    }

    if (selectedUser.isActive === false) {
      setPinError('Šio darbuotojo prieiga yra deaktyvuota administratoriaus.');
      return;
    }

    const trimmedPin = pinInput.trim();
    if (!trimmedPin) {
      setPinError('Įveskite 4 skaitmenų PIN kodą.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      // Find expected PIN
      const adminCustomPin = (selectedUser.pinCode && selectedUser.pinCode !== '1234')
        ? selectedUser.pinCode
        : (authSettings.adminPin && authSettings.adminPin !== '1234' ? authSettings.adminPin : null);

      let isPinValid = false;
      if (selectedUser.role === 'admin') {
        if (adminCustomPin) {
          isPinValid = trimmedPin === adminCustomPin;
        } else {
          isPinValid = trimmedPin === '1234' || trimmedPin === selectedUser.pinCode || trimmedPin === authSettings.adminPin;
        }
      } else {
        const expectedPin = selectedUser.pinCode || '1234';
        isPinValid = trimmedPin === expectedPin;
      }

      if (isPinValid) {
        setSuccessUser(selectedUser);
        setTimeout(() => {
          onLoginSuccess(selectedUser);
        }, 500);
      } else {
        setIsLoading(false);
        setPinError('Neteisingas PIN kodas. Bandykite dar kartą.');
      }
    }, 300);
  };

  return (
    <div className="min-h-screen w-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto font-sans">
      {/* Top Status Bar */}
      <div className="w-full max-w-4xl mx-auto flex items-center justify-between py-2 text-slate-300 text-xs">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          <span className="font-mono text-slate-200 font-semibold">Proxmox VE · Cloudflare Access</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-emerald-400 font-bold">Serveris aktyvus</span>
        </div>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-white border-2 border-slate-300 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header with Crest */}
          <div className="p-6 sm:p-7 text-center bg-slate-50 border-b border-slate-200">
            <div className="inline-block relative mb-3">
              <div className="w-20 h-20 rounded-2xl bg-white p-2 shadow-sm flex items-center justify-center border-2 border-slate-300 mx-auto">
                <img 
                  src="/assets/aistudio/__05425c32.jpg" 
                  alt="Tryškių Lazdynų Pelėdos herbas" 
                  className="max-h-16 max-w-16 object-contain"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 bg-emerald-600 text-white p-1 rounded-full border-2 border-white shadow-xs">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>

            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Telšių raj. Tryškių Lazdynų Pelėdos gimnazija
            </h2>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              Inventoriaus sistema
            </h1>
            <p className="text-xs text-slate-600 mt-1 font-medium">
              Materialiojo turto, IT įrangos ir kabinetų apskaita
            </p>
          </div>

          {/* Success Overlay Animation */}
          {successUser ? (
            <div className="p-8 text-center space-y-3 bg-emerald-50/60 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-300 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Sveiki, {successUser.fullName}!</h3>
              <p className="text-xs text-slate-600 font-medium">
                Prieiga patvirtinta ({successUser.roleTitle}). Atidaroma sistema...
              </p>
            </div>
          ) : (
            <form onSubmit={handleLoginSubmit} className="p-6 sm:p-7 space-y-5">
              {/* 1. Select Staff Member */}
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1.5 flex items-center justify-between">
                  <span>Pasirinkite darbuotoją / mokytoją</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {activeUsers.length} registruoti
                  </span>
                </label>
                <div className="relative">
                  <select
                    value={selectedUserId}
                    onChange={(e) => {
                      setSelectedUserId(e.target.value);
                      setPinError(null);
                    }}
                    className="w-full bg-white border-2 border-slate-300 rounded-lg px-3 py-2.5 text-xs text-slate-900 font-bold focus:border-blue-600 focus:ring-2 focus:ring-blue-100 cursor-pointer shadow-2xs"
                  >
                    {activeUsers.map((u) => (
                      <option key={u.id} value={u.id} className="text-slate-900 font-medium py-1">
                        {u.fullName} — {u.roleTitle}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Selected User Details Pill */}
              {selectedUser && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>{selectedUser.fullName}</span>
                  </div>
                  <div className="text-slate-600 font-medium text-[11px]">{selectedUser.roleTitle}</div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">{selectedUser.email}</div>
                </div>
              )}

              {/* 2. Enter PIN */}
              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1.5">
                  Asmeninis 4 skaitmenų PIN kodas
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    autoFocus
                    maxLength={8}
                    placeholder="••••"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      setPinError(null);
                    }}
                    className="w-full bg-white border-2 border-slate-300 rounded-lg pl-9 pr-3 py-2.5 text-base text-slate-900 font-bold font-mono tracking-widest text-center placeholder:text-slate-400 placeholder:font-normal focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all shadow-2xs"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Įveskite savo asmeninį konfidencialų PIN kodą.
                </p>
              </div>

              {/* Error Message */}
              {pinError && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-xs flex items-start gap-2 animate-fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-semibold">{pinError}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <span>Tikrinamas PIN...</span>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Prisijungti su PIN</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>

              {/* Security Badge */}
              <div className="pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Apsaugota Cloudflare Access
                  </span>
                  <span>Tryškių gimnazija</span>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="w-full max-w-4xl mx-auto text-center py-3 text-slate-400 text-xs border-t border-slate-800">
        Telšių r. Tryškių Lazdynų Pelėdos gimnazija · Lazdynų Pelėdos g. 20, Tryškiai · Proxmox VE
      </div>
    </div>
  );
};
