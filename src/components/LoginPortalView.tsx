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
  Server,
  ArrowLeft,
  UserCheck,
  Building2
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
  const [authMethod, setAuthMethod] = useState<'2fa_email' | 'quick_pin'>('2fa_email');
  
  // 2FA Email flow state:
  // Step 1: verify email against staff whitelist
  // Step 2: verify PIN for identified staff member
  const [emailStep, setEmailStep] = useState<'email' | 'pin'>('email');
  const [emailInput, setEmailInput] = useState('');
  const [matchedStaff, setMatchedStaff] = useState<User | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [staffPinInput, setStaffPinInput] = useState('');
  const [staffPinError, setStaffPinError] = useState<string | null>(null);

  // Quick PIN state (for local classroom tablets):
  const [selectedUserId, setSelectedUserId] = useState<string>(users[0]?.id || '');
  const [quickPinInput, setQuickPinInput] = useState('');
  const [quickPinError, setQuickPinError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [successUser, setSuccessUser] = useState<User | null>(null);

  // --- Step 1: Verify Email Whitelist ---
  const handleVerifyEmail = (e: React.FormEvent) => {
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

        setIsLoading(false);
        setMatchedStaff(matched);
        setEmailStep('pin');
        setStaffPinInput('');
        setStaffPinError(null);
        return;
      }

      // 2. Not in authorized staff whitelist (e.g. Student with @tryskiumokykla.lt or external person)
      setIsLoading(false);
      onAccessDenied(email);
    }, 350);
  };

  // --- Step 2: Verify PIN for identified staff member ---
  const handleVerifyStaffPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedStaff) return;
    setStaffPinError(null);

    const trimmedPin = staffPinInput.trim();
    if (!trimmedPin) {
      setStaffPinError('Įveskite savo 4 skaitmenų PIN kodą.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const isUserPinValid = matchedStaff.pinCode && matchedStaff.pinCode === trimmedPin;
      const isAdminMasterPinValid = authSettings.adminPin && authSettings.adminPin === trimmedPin;

      if (isUserPinValid || isAdminMasterPinValid) {
        setSuccessUser(matchedStaff);
        setTimeout(() => {
          onLoginSuccess(matchedStaff);
        }, 500);
      } else {
        setIsLoading(false);
        setStaffPinError('Neteisingas PIN kodas. Numatytasis administratoriaus PIN: 1234. Jei pamiršote, kreipkitės į administratorių.');
      }
    }, 300);
  };

  // --- Quick PIN Handler (Local Network) ---
  const handleQuickPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickPinError(null);

    const targetUser = users.find((u) => u.id === selectedUserId);
    if (!targetUser) {
      setQuickPinError('Pasirinkite darbuotoją iš sąrašo.');
      return;
    }

    if (targetUser.isActive === false) {
      setQuickPinError(`Šio naudotojo paskyra yra deaktyvuota administratoriaus.`);
      return;
    }

    const trimmedPin = quickPinInput.trim();
    if (!trimmedPin) {
      setQuickPinError('Įveskite 4 skaitmenų PIN kodą.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const isUserPinValid = targetUser.pinCode && targetUser.pinCode === trimmedPin;
      const isAdminMasterPinValid = authSettings.adminPin && authSettings.adminPin === trimmedPin;

      if (isUserPinValid || isAdminMasterPinValid) {
        setSuccessUser(targetUser);
        setTimeout(() => {
          onLoginSuccess(targetUser);
        }, 500);
      } else {
        setIsLoading(false);
        setQuickPinError('Neteisingas PIN kodas.');
      }
    }, 300);
  };

  return (
    <div className="min-h-screen w-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto font-sans">
      {/* Top Brand Bar */}
      <div className="w-full max-w-4xl mx-auto flex items-center justify-between py-2 text-slate-300 text-xs">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          <span className="font-mono text-slate-200 font-semibold">Proxmox VE · Cloudflare Tunnel</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-emerald-400 font-bold">Serveris aktyvus</span>
        </div>
      </div>

      {/* Main Crisp High-Contrast Login Card */}
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
            <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto font-medium">
              Materialiojo turto, IT įrangos ir kabinetų apskaitos portalas
            </p>
          </div>

          {/* Success Animation */}
          {successUser ? (
            <div className="p-8 text-center space-y-3 bg-emerald-50/60 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-300 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Sveiki, {successUser.fullName}!</h3>
              <p className="text-xs text-slate-600 font-medium">
                Prieiga patvirtinta ({successUser.roleTitle}). Jungiamasi prie sistemos...
              </p>
            </div>
          ) : (
            <div className="p-6 sm:p-7 space-y-5">
              {/* Security Mode Selector */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('2fa_email');
                    setEmailStep('email');
                    setEmailError(null);
                    setStaffPinError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMethod === '2fa_email'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Saugus el. paštas + PIN</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('quick_pin');
                    setQuickPinError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMethod === 'quick_pin'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Kabineto PIN</span>
                </button>
              </div>

              {/* METHOD 1: SECURE 2-STEP (EMAIL WHITELIST + PERSONAL PIN) */}
              {authMethod === '2fa_email' && (
                <>
                  {emailStep === 'email' ? (
                    /* STEP 1: EMAIL IDENTIFICATION */
                    <form onSubmit={handleVerifyEmail} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-900 mb-1.5">
                          Gimnazijos arba patvirtintas darbuotojo el. paštas
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                            <Mail className="w-4 h-4" />
                          </div>
                          <input
                            type="email"
                            required
                            autoFocus
                            placeholder="pvz., kestutis.l@tryskiumokykla.lt"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            className="w-full bg-white border-2 border-slate-300 rounded-lg pl-9 pr-3 py-2.5 text-xs text-slate-900 font-semibold placeholder:text-slate-400 placeholder:font-normal focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5">
                          Įveskite savo darbinį gimnazijos el. paštą arba administratoriui pateiktą asmeninį Gmail.
                        </p>
                      </div>

                      {emailError && (
                        <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <span className="font-medium">{emailError}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isLoading ? (
                          <span>Tikrinamas darbuotojų sąrašas...</span>
                        ) : (
                          <>
                            <span>Tęsti (Tikrinti prieigą)</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </form>
                  ) : (
                    /* STEP 2: STAFF MEMBER IDENTIFIED -> ENTER PIN */
                    <form onSubmit={handleVerifyStaffPin} className="space-y-4 animate-fade-in">
                      {matchedStaff && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                              <UserCheck className="w-3.5 h-3.5" />
                              Patvirtintas darbuotojas
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEmailStep('email');
                                setStaffPinInput('');
                                setStaffPinError(null);
                              }}
                              className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer underline"
                            >
                              <ArrowLeft className="w-3 h-3" />
                              <span>Keisti el. paštą</span>
                            </button>
                          </div>
                          <div className="font-bold text-slate-900 text-sm">{matchedStaff.fullName}</div>
                          <div className="text-slate-600 font-medium">{matchedStaff.roleTitle}</div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">{matchedStaff.email}</div>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-bold text-slate-900 mb-1.5">
                          Įveskite savo asmeninį 4 skaitmenų PIN kodą
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
                            value={staffPinInput}
                            onChange={(e) => setStaffPinInput(e.target.value)}
                            className="w-full bg-white border-2 border-slate-300 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-900 font-bold font-mono tracking-widest text-center placeholder:text-slate-400 placeholder:font-normal focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Numatytasis administratoriaus PIN: <strong className="text-slate-700 font-mono">1234</strong>
                        </p>
                      </div>

                      {staffPinError && (
                        <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <span className="font-medium">{staffPinError}</span>
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
                            <span>Patvirtinti ir atidaryti registrą</span>
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </>
              )}

              {/* METHOD 2: QUICK PIN (FOR CLASSROOM TABLETS) */}
              {authMethod === 'quick_pin' && (
                <form onSubmit={handleQuickPinSubmit} className="space-y-4">
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Pastaba:</strong> Šis būdas skirtas greitam prisijungimui kabineto planšetėje. Viešajame internete rekomenduojame jungtis per „Saugus el. paštas + PIN“.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1.5">
                      Pasirinkite darbuotoją / mokytoją
                    </label>
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="w-full bg-white border-2 border-slate-300 rounded-lg px-3 py-2.5 text-xs text-slate-900 font-bold focus:border-blue-600 focus:ring-2 focus:ring-blue-100 cursor-pointer"
                    >
                      {users
                        .filter((u) => u.isActive !== false)
                        .map((u) => (
                          <option key={u.id} value={u.id} className="text-slate-900 font-medium py-1">
                            {u.fullName} — {u.roleTitle}
                          </option>
                        ))}
                    </select>
                  </div>

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
                        maxLength={8}
                        placeholder="••••"
                        value={quickPinInput}
                        onChange={(e) => setQuickPinInput(e.target.value)}
                        className="w-full bg-white border-2 border-slate-300 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-900 font-bold font-mono tracking-widest text-center placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                      />
                    </div>
                  </div>

                  {quickPinError && (
                    <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span className="font-medium">{quickPinError}</span>
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
                        <span>Prisijungti su PIN</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Security Rule Warning */}
              <div className="pt-2 border-t border-slate-200">
                <div className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900 block">Saugumo taisyklė:</span>
                    Mokiniams prieiga prie inventoriaus ir nurašymo dokumentų yra griežtai draudžiama. Tik įgaliotas gimnazijos personalas gali jungtis prie registro.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="w-full max-w-4xl mx-auto text-center py-3 text-slate-400 text-xs border-t border-slate-800">
        Telšių r. Tryškių Lazdynų Pelėdos gimnazija · Lazdynų Pelėdos g. 20, Tryškiai · Proxmox VE saugykla
      </div>
    </div>
  );
};
