import React, { useState } from 'react';
import { ShieldAlert, Lock, Mail, KeyRound, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { User, AuthSettings } from '../types/inventory';

interface AccessDeniedViewProps {
  attemptedEmail?: string;
  adminUser?: User;
  authSettings: AuthSettings;
  onAdminPinSuccess: () => void;
  onRetryDifferentEmail: () => void;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  attemptedEmail,
  adminUser,
  authSettings,
  onAdminPinSuccess,
  onRetryDifferentEmail,
}) => {
  const [showPinInput, setShowPinInput] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    const trimmed = pin.trim();
    if (trimmed === authSettings.adminPin || (adminUser?.pinCode && trimmed === adminUser.pinCode)) {
      onAdminPinSuccess();
    } else {
      setPinError('Neteisingas administratoriaus PIN kodas.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 max-w-lg w-full rounded-2xl shadow-2xl p-6 sm:p-8 text-center space-y-6">
        
        {/* School Crest & Security Shield */}
        <div className="flex flex-col items-center">
          <div className="relative mb-3">
            <div className="w-16 h-16 rounded-xl bg-white p-1.5 shadow-md flex items-center justify-center border border-slate-300">
              <img 
                src="/assets/aistudio/__05425c32.jpg" 
                alt="Tryškių Lazdynų Pelėdos herbas" 
                className="max-h-14 max-w-14 object-contain"
              />
            </div>
            <div className="absolute -bottom-2 -right-2 bg-rose-600 text-white p-1 rounded-full border-2 border-slate-800 shadow-sm">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Telšių raj. Tryškių Lazdynų Pelėdos gimnazija
          </h2>
          <h1 className="text-xl font-bold text-white mt-1">
            Prieiga apribota
          </h1>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full text-xs font-semibold mt-2">
            <span>Tik patvirtintas mokyklos personalas</span>
          </div>
        </div>

        {/* Informative Explanation */}
        <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-4 text-left space-y-3">
          {attemptedEmail && (
            <div className="flex items-center gap-2 text-xs text-slate-300 pb-2 border-b border-slate-800">
              <Mail className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Atpažintas el. paštas: <strong className="text-white font-mono">{attemptedEmail}</strong></span>
            </div>
          )}

          <p className="text-xs text-slate-300 leading-relaxed">
            Jūsų paskyra sėkmingai atpažinta gimnazijos domene, tačiau šis el. pašto adresas 
            <strong className="text-rose-400"> nėra įtrauktas į patvirtintų materialiai atsakingų darbuotojų registrą</strong>.
          </p>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Mokiniams ir neįgaliotiems asmenims prieiga prie gimnazijos materialiojo turto, IT įrangos ir nurašymo dokumentų valdymo sistemos yra uždrausta.
          </p>
        </div>

        {/* Administrator Contact Info */}
        <div className="bg-blue-950/40 border border-blue-800/40 rounded-xl p-3 text-xs text-slate-300 text-left flex items-start gap-3">
          <HelpCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-white">Esate mokyklos mokytojas ar darbuotojas?</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Kreipkitės į IT administratorių, kad suteiktų prieigą prie jūsų kabineto turto:
            </div>
            <div className="text-[11px] text-blue-300 font-mono mt-1 font-semibold">
              Kęstutis Labanauskas ({adminUser?.email || 'kestutis.labanauskas@tryskiumokykla.lt'})
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="space-y-3 pt-2">
          {!showPinInput ? (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={onRetryDifferentEmail}
                className="w-full sm:flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Prisijungti su kitu el. paštu
              </button>
              <button
                type="button"
                onClick={() => setShowPinInput(true)}
                className="w-full sm:flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Admin prieiga (PIN)</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handlePinSubmit} className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-700 animate-fade-in">
              <div className="text-left">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Administratoriaus patvirtinimo PIN kodas
                </label>
                <input
                  type="password"
                  autoFocus
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Įveskite 4 skaitmenų PIN"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-center tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {pinError && (
                <div className="text-[11px] text-rose-400 font-medium text-left">
                  {pinError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPinInput(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Patvirtinti administratoriaus teises
                </button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};
