import React, { useState } from 'react';
import { 
  LogIn, 
  Mail, 
  KeyRound, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  School,
  Lock,
  ArrowRight,
  ShieldAlert,
  Server
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
  onAccessDenied,
}) => {
  const [authMethod, setAuthMethod] = useState<'email' | 'pin'>('email');
  
  // Email state
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  // PIN state
  const [selectedUserId, setSelectedUserId] = useState<string>(users[0]?.id || '');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [successUser, setSuccessUser] = useState<User | null>(null);

  // Email login handler
  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    const email = emailInput.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      setEmailError('Įveskite galiojantį el. pašto adresą.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      // 1. Search for matching staff user in the registry
      const matched = users.find(
        (u) =>
          u.email.toLowerCase() === email ||
          (u.allowedGmail && u.allowedGmail.toLowerCase() === email)
      );

      if (matched) {
        if (matched.isActive === false) {
          setIsLoading(false);
          setEmailError(`Darbuotojo „${matched.fullName}“ prieiga yra deaktyvuota administratoriaus.`);
          return;
        }

        setSuccessUser(matched);
        setTimeout(() => {
          onLoginSuccess(matched);
        }, 600);
        return;
      }

      // 2. Not in authorized staff whitelist (e.g. Student with @tryskiumokykla.lt or external person)
      setIsLoading(false);
      onAccessDenied(email);
    }, 400);
  };

  // PIN login handler
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);

    const targetUser = users.find((u) => u.id === selectedUserId);
    if (!targetUser) {
      setPinError('Pasirinkite darbuotoją iš sąrašo.');
      return;
    }

    if (targetUser.isActive === false) {
      setPinError(`Šio naudotojo paskyra yra deaktyvuota administratoriaus.`);
      return;
    }

    const trimmedPin = pinInput.trim();
    if (!trimmedPin) {
      setPinError('Įveskite 4 skaitmenų PIN kodą.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      // Check individual user PIN or master admin PIN
      const isUserPinValid = targetUser.pinCode && targetUser.pinCode === trimmedPin;
      const isAdminMasterPinValid = authSettings.adminPin && authSettings.adminPin === trimmedPin;

      if (isUserPinValid || isAdminMasterPinValid) {
        setSuccessUser(targetUser);
        setTimeout(() => {
          onLoginSuccess(targetUser);
        }, 600);
      } else {
        setIsLoading(false);
        setPinError('Neteisingas PIN kodas. Bandykite dar kartą arba kreipkitės į administratorių.');
      }
    }, 350);
  };

  return (
    <div className="min-h-screen w-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto font-sans">
      {/* Top Brand Bar */}
      <div className="w-full max-w-5xl mx-auto flex items-center justify-between py-2 text-slate-400 text-xs">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          <span className="font-mono text-slate-300">Proxmox VE · Cloudflare Tunnel</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-emerald-400 font-medium">Serveris aktyvus</span>
        </div>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto my-auto">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Header with Crest */}
          <div className="p-6 sm:p-8 text-center bg-gradient-to-b from-slate-800 to-slate-900/90 border-b border-slate-700/60">
            <div className="inline-block relative mb-4">
              <div className="w-20 h-20 rounded-2xl bg-white p-2 shadow-lg flex items-center justify-center border-2 border-slate-700 mx-auto">
                <img 
                  src="/assets/aistudio/__05425c32.jpg" 
                  alt="Tryškių Lazdynų Pelėdos herbas" 
                  className="max-h-16 max-w-16 object-contain"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1 rounded-full border-2 border-slate-900 shadow-xs">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>

            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Telšių raj. Tryškių Lazdynų Pelėdos gimnazija
            </h2>
            <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
              Inventoriaus sistema
            </h1>
            <p className="text-xs text-slate-400 mt-1.5 max-w-xs mx-auto">
              Materialiojo turto, IT įrangos ir inventorizacijos apskaitos portalas
            </p>
          </div>

          {/* Success Overlay Animation */}
          {successUser ? (
            <div className="p-8 text-center space-y-3 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white">Sveiki, {successUser.fullName}!</h3>
              <p className="text-xs text-slate-400">
                Prieiga patvirtinta ({successUser.roleTitle}). Jungiamasi prie sistemos...
              </p>
            </div>
          ) : (
            <div className="p-6 sm:p-8 space-y-6">
              {/* Method Switcher Tabs */}
              <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('email');
                    setEmailError(null);
                    setPinError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    authMethod === 'email'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>El. paštas (Baltasis sąrašas)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('pin');
                    setEmailError(null);
                    setPinError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    authMethod === 'pin'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>PIN kodas</span>
                </button>
              </div>

              {/* METHOD 1: EMAIL LOGIN */}
              {authMethod === 'email' && (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Gimnazijos arba susietas Google el. paštas
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        type="email"
                        required
                        placeholder="pvz., kestutis.l@tryskiumokykla.lt"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Įveskite savo darbinį gimnazijos el. paštą arba administratoriui nurodytą Gmail.
                    </p>
                  </div>

                  {emailError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{emailError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <span>Tikrinama prieiga...</span>
                    ) : (
                      <>
                        <span>Prisijungti</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* METHOD 2: PIN LOGIN */}
              {authMethod === 'pin' && (
                <form onSubmit={handlePinSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Darbuotojas / Mokytojas
                    </label>
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {users
                        .filter((u) => u.isActive !== false)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName} — {u.roleTitle}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Asmeninis 4 skaitmenų PIN kodas
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type="password"
                        maxLength={8}
                        placeholder="••••"
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono tracking-widest text-center text-sm font-bold"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Numatytasis administratoriaus PIN: <strong className="text-slate-300 font-mono">1234</strong>
                    </p>
                  </div>

                  {pinError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{pinError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <span>Tikrinamas PIN...</span>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        <span>Patvirtinti PIN ir prisijungti</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Security Warning notice */}
              <div className="pt-2 border-t border-slate-700/60">
                <div className="flex items-start gap-2.5 p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 text-[11px] text-slate-400">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-300 block">Saugumo taisyklė:</span>
                    Mokiniams prieiga prie inventoriaus ir nurašymo aktų yra griežtai apribota. Tik autorizuoti mokyklos darbuotojai turi teisę jungtis.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="w-full max-w-5xl mx-auto text-center py-4 text-slate-500 text-xs border-t border-slate-800">
        Telšių r. Tryškių Lazdynų Pelėdos gimnazija · Lazdynų Pelėdos g. 20, Tryškiai · Savarankiško talpinimo sistema (Proxmox VE)
      </div>
    </div>
  );
};
