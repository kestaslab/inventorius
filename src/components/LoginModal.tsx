import React, { useState } from 'react';
import { 
  X, 
  LogIn, 
  Mail, 
  Lock, 
  ShieldCheck, 
  AlertCircle, 
  School, 
  KeyRound, 
  CheckCircle2, 
  UserCheck 
} from 'lucide-react';
import { User, AuthSettings } from '../types/inventory';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  authSettings: AuthSettings;
  currentUser: User;
  onLoginSuccess: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  users,
  authSettings,
  currentUser,
  onLoginSuccess,
}) => {
  const [authTab, setAuthTab] = useState<'google' | 'pin'>('google');
  const [googleEmail, setGoogleEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUser.id);
  const [pinInput, setPinInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successUser, setSuccessUser] = useState<User | null>(null);

  if (!isOpen) return null;

  // Google / Gmail login check
  const handleGoogleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const email = googleEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setErrorMessage('Įveskite teisingą Google / Gmail el. pašto adresą.');
      return;
    }

    // 1. Check if matches any active user directly by email or allowedGmail
    const matchedUser = users.find(
      (u) =>
        u.email.toLowerCase() === email ||
        (u.allowedGmail && u.allowedGmail.toLowerCase() === email)
    );

    if (matchedUser) {
      if (matchedUser.isActive === false) {
        setErrorMessage(`Naudotojo „${matchedUser.fullName}“ paskyra yra deaktyvuota administratoriaus.`);
        return;
      }
      setSuccessUser(matchedUser);
      setTimeout(() => {
        onLoginSuccess(matchedUser);
        onClose();
        setSuccessUser(null);
        setGoogleEmail('');
      }, 700);
      return;
    }

    // 2. Check if strict whitelist is enabled
    if (authSettings.allowOnlyWhitelistedEmails) {
      const isDomainAllowed = email.endsWith(`@${authSettings.allowedSchoolDomain.toLowerCase()}`);
      const isExplicitlyWhitelisted = authSettings.whitelistedEmails.some(
        (w) => w.toLowerCase() === email
      );

      if (!isDomainAllowed && !isExplicitlyWhitelisted) {
        setErrorMessage(
          `Prieiga nesuteikta: El. pašto adresas „${email}“ neįtrauktas į gimnazijos patvirtintą naudotojų registrą. Kreipkitės į administratorių (Kęstutį Labanauską), kad sukurtų naudotoją arba pridėtų šį Gmail į baltąjį sąrašą.`
        );
        return;
      }
    }

    // 3. Fallback or generic school email
    setErrorMessage(
      `El. paštas „${email}“ atitinka leistinus domenus, tačiau šiame inventoriaus serveryje dar nesukurta konkreti naudotojo paskyra. Administratorius turi priskirti rolę.`
    );
  };

  // Quick PIN / Employee Login
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const user = users.find((u) => u.id === selectedUserId);
    if (!user) {
      setErrorMessage('Pasirinkite naudotoją');
      return;
    }

    if (user.isActive === false) {
      setErrorMessage(`Naudotojo „${user.fullName}“ paskyra yra deaktyvuota.`);
      return;
    }

    // Check PIN: strictly matches user's pinCode (or admin pin if admin)
    const trimmedPin = pinInput.trim();
    const expectedPin = user.pinCode || (user.role === 'admin' ? authSettings.adminPin : undefined);
    if (!expectedPin || expectedPin !== trimmedPin) {
      setErrorMessage('Neteisingas PIN kodas. Bandykite dar kartą.');
      return;
    }

    setSuccessUser(user);
    setTimeout(() => {
      onLoginSuccess(user);
      onClose();
      setSuccessUser(null);
      setPinInput('');
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 overflow-hidden animate-fade-in backdrop-blur-2xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 relative shrink-0">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 border border-slate-700 shadow-sm overflow-hidden">
              <img 
                src="/assets/aistudio/__05425c32.jpg" 
                alt="Tryškių Lazdynų Pelėdos herbas" 
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Gimnazijos Inventoriaus Sistema</h2>
              <p className="text-xs text-slate-300">Telšių raj. Tryškių Lazdynų Pelėdos gimnazija</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Prisijungimas prie materialiojo turto apskaitos ir patikros modulio
          </p>
        </div>

        {/* Tab switchers: Google vs PIN */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold shrink-0">
          <button
            type="button"
            onClick={() => {
              setAuthTab('google');
              setErrorMessage(null);
            }}
            className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              authTab === 'google'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {/* Google G icon */}
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Google / Gmail</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthTab('pin');
              setErrorMessage(null);
            }}
            className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              authTab === 'pin'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-4 h-4 text-slate-500" />
            <span>Darbuotojų PIN</span>
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="overflow-y-auto flex-1 overscroll-contain">

        {/* Success Alert */}
        {successUser && (
          <div className="p-4 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold">Sėkmingai autorizuota!</p>
              <p>Prisijungiama kaip: {successUser.fullName} ({successUser.roleTitle})</p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block mb-0.5">Autorizacijos klaida:</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Tab 1: Google / Gmail Whitelist Login */}
        {authTab === 'google' && (
          <form onSubmit={handleGoogleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Įveskite patvirtintą el. paštą arba Gmail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  placeholder="pvz. kestutis.labanauskas@tryskiumokykla.lt"
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Prieiga suteikiama tik įgaliotiems Tryškių gimnazijos darbuotojams.
              </p>
            </div>

            {/* Quick pre-filled buttons for convenience */}
            <div className="pt-2">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Greiti pavyzdžiai bandymui:
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setGoogleEmail('kestutis.labanauskas@tryskiumokykla.lt')}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-mono cursor-pointer"
                >
                  kestutis.labanauskas... (Admin)
                </button>
                <button
                  type="button"
                  onClick={() => setGoogleEmail('kestutis.tryskiai@gmail.com')}
                  className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[11px] font-mono cursor-pointer"
                >
                  kestutis.tryskiai@gmail.com
                </button>
                <button
                  type="button"
                  onClick={() => setGoogleEmail('neleistinas@gmail.com')}
                  className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[11px] font-mono cursor-pointer"
                  title="Išbandyti neautorizuotą adresą"
                >
                  neleistinas@gmail.com (Test bloko)
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <LogIn className="w-4 h-4" />
              <span>Tikrinti tapatybę ir prisijungti</span>
            </button>
          </form>
        )}

        {/* Tab 2: Employee PIN Login */}
        {authTab === 'pin' && (
          <form onSubmit={handlePinSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pasirinkite naudotoją
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 font-medium cursor-pointer"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} — {u.roleTitle} ({u.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                PIN kodas
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="••••"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>Prisijungti su PIN</span>
            </button>
          </form>
        )}
        </div>

        {/* Footer info (Pinned) */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[10px] text-slate-500 flex items-center justify-center gap-1.5 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Savarankiška Proxmox Debian apsauga · Baltojo sąrašo kontrolė</span>
        </div>
      </div>
    </div>
  );
};
