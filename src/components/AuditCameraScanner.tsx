import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, RefreshCw, AlertTriangle, SwitchCamera, X } from 'lucide-react';
import { getAuditCameraErrorMessage } from '../utils/auditUtils';

interface AuditCameraScannerProps {
  isOpen: boolean;
  disabled?: boolean;
  onDecodedCode: (rawText: string) => void;
  onClose: () => void;
}

interface NativeBarcodeDetector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
}

const DUPLICATE_COOLDOWN_MS = 2500;
const SCAN_INTERVAL_MS = 120;

export const AuditCameraScanner: React.FC<AuditCameraScannerProps> = ({
  isOpen,
  disabled = false,
  onDecodedCode,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastFrameScanAtRef = useRef<number>(0);
  const lastScannedRef = useRef<{ value: string; timestamp: number } | null>(null);
  const disabledRef = useRef<boolean>(disabled);
  const onDecodedRef = useRef(onDecodedCode);
  const barcodeDetectorRef = useRef<NativeBarcodeDetector | null>(null);

  const [status, setStatus] = useState<'idle' | 'starting' | 'active' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [lastHighlightCode, setLastHighlightCode] = useState<string | null>(null);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    onDecodedRef.current = onDecodedCode;
  }, [onDecodedCode]);

  const stopCameraResources = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore cleanup failure
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (preferredDeviceId?: string) => {
      stopCameraResources();

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setStatus('error');
        setErrorMessage(
          typeof window !== 'undefined' && !window.isSecureContext
            ? 'Kamera naršyklėje veikia tik per saugų HTTPS ryšį arba localhost adresą. Naudokite rankinį įvedimą arba USB skaitytuvą.'
            : 'Ši naršyklė arba įrenginys nepalaiko kameros prieigos. Naudokite rankinį kodo įvedimą arba USB skaitytuvą.'
        );
        return;
      }

      setStatus('starting');
      setErrorMessage(null);

      let cancelled = false;
      try {
        const videoConstraint: MediaTrackConstraints = preferredDeviceId
          ? {
              deviceId: { exact: preferredDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,
            audio: false,
          });
        } catch (firstErr) {
          // Jei tikslios galinės kameros ar raiškos nepavyko parinkti, bandome paprastesnį constraint
          if (!preferredDeviceId) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } else {
            throw firstErr;
          }
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.setAttribute('playsinline', 'true');
          await videoEl.play().catch(() => {
            // Kai kurios mobilios naršyklės paleidžia po metadata
          });
        }

        // Po leidimo suteikimo nuskaitome kamerų sąrašą (pvz., priekinė / galinė)
        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
          try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
            setDevices(videoInputs);

            const activeTrack = stream.getVideoTracks()[0];
            const activeId = activeTrack?.getSettings?.().deviceId;
            if (activeId) {
              setSelectedDeviceId(activeId);
            } else if (!preferredDeviceId && videoInputs.length > 0) {
              const rear = videoInputs.find((d) =>
                /back|rear|environment|galin/i.test(d.label)
              );
              setSelectedDeviceId((rear || videoInputs[0]).deviceId);
            }
          } catch {
            // Device enumeration optional
          }
        }

        // Pasirenkame BarcodeDetector jei naršyklė palaiko (naudinga ir 1D brūkšniniams kodams)
        if (!barcodeDetectorRef.current && typeof window !== 'undefined') {
          const w = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor };
          if (typeof w.BarcodeDetector === 'function') {
            try {
              barcodeDetectorRef.current = new w.BarcodeDetector({
                formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'],
              });
            } catch {
              barcodeDetectorRef.current = null;
            }
          }
        }

        setStatus('active');

        const scanLoop = async (timestamp: number) => {
          if (!streamRef.current) return;

          if (timestamp - lastFrameScanAtRef.current >= SCAN_INTERVAL_MS) {
            lastFrameScanAtRef.current = timestamp;
            const video = videoRef.current;
            const canvas = canvasRef.current;

            if (
              video &&
              canvas &&
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              video.videoWidth > 0 &&
              video.videoHeight > 0 &&
              !disabledRef.current
            ) {
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                }
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                let decodedValue: string | null = null;
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: 'attemptBoth',
                });
                if (qr?.data?.trim()) {
                  decodedValue = qr.data.trim();
                } else if (barcodeDetectorRef.current) {
                  try {
                    const detected = await barcodeDetectorRef.current.detect(canvas);
                    const first = detected.find((d) => Boolean(d.rawValue?.trim()));
                    if (first?.rawValue) {
                      decodedValue = first.rawValue.trim();
                    }
                  } catch {
                    // ignore detector errors
                  }
                }

                if (decodedValue && !disabledRef.current) {
                  const now = Date.now();
                  const prev = lastScannedRef.current;
                  const normalizedKey = decodedValue.trim().toUpperCase();
                  const isDuplicate =
                    prev &&
                    prev.value === normalizedKey &&
                    now - prev.timestamp < DUPLICATE_COOLDOWN_MS;

                  if (!isDuplicate) {
                    lastScannedRef.current = { value: normalizedKey, timestamp: now };
                    setLastHighlightCode(decodedValue);
                    onDecodedRef.current(decodedValue);
                  }
                }
              }
            }
          }

          if (streamRef.current) {
            rafIdRef.current = requestAnimationFrame((ts) => {
              void scanLoop(ts);
            });
          }
        };

        rafIdRef.current = requestAnimationFrame((ts) => {
          void scanLoop(ts);
        });
      } catch (err) {
        if (!cancelled) {
          stopCameraResources();
          setStatus('error');
          setErrorMessage(getAuditCameraErrorMessage(err));
        }
      }

      return () => {
        cancelled = true;
      };
    },
    [stopCameraResources]
  );

  useEffect(() => {
    if (!isOpen) {
      stopCameraResources();
      setStatus('idle');
      setErrorMessage(null);
      setLastHighlightCode(null);
      return;
    }

    let disposed = false;
    void startCamera(selectedDeviceId || undefined).then(() => {
      if (disposed) {
        stopCameraResources();
      }
    });

    return () => {
      disposed = true;
      stopCameraResources();
    };
    // Paleidžiame tik pasikeitus isOpen arba vartotojui perjungus kamerą
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedDeviceId]);

  if (!isOpen) return null;

  const handleSwitchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    setSelectedDeviceId(devices[nextIndex].deviceId);
  };

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-700 shadow-lg text-white">
      <div className="px-4 py-2.5 bg-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold truncate">Kameros QR skaitytuvas</span>
          {status === 'active' && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold">
              Veikia
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {devices.length > 1 && (
            <button
              type="button"
              onClick={handleSwitchCamera}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[11px] font-semibold cursor-pointer"
              title="Perjungti kamerą (priekinė / galinė)"
            >
              <SwitchCamera className="w-3.5 h-3.5" />
              <span>Kamera</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              stopCameraResources();
              onClose();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-600/80 hover:bg-rose-600 text-[11px] font-bold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Stabdyti</span>
          </button>
        </div>
      </div>

      <div className="relative bg-black flex items-center justify-center min-h-[220px]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full max-h-[280px] object-cover ${
            status === 'active' ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {status === 'active' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-44 h-44 border-2 border-emerald-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] flex items-end justify-center pb-2">
              <span className="text-[10px] font-semibold bg-slate-900/80 text-emerald-200 px-2 py-0.5 rounded">
                Nukreipkite į QR etiketę
              </span>
            </div>
          </div>
        )}

        {status === 'starting' && (
          <div className="p-6 text-center space-y-2">
            <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-300">Jungiamasi prie galinės kameros...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="p-5 text-center space-y-3 max-w-sm">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center mx-auto">
              <CameraOff className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-rose-200 flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Kamera nepasiekiama</span>
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">{errorMessage}</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void startCamera(selectedDeviceId || undefined)}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-bold cursor-pointer"
              >
                Bandyti dar kartą
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCameraResources();
                  onClose();
                }}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs font-semibold cursor-pointer"
              >
                Uždaryti
              </button>
            </div>
          </div>
        )}
      </div>

      {lastHighlightCode && status === 'active' && (
        <div className="px-3 py-1.5 bg-slate-800/90 border-t border-slate-700 text-[11px] text-emerald-300 flex items-center justify-between gap-2">
          <span className="truncate">
            Paskutinis nuskaitytas kodas: <strong className="font-mono">{lastHighlightCode}</strong>
          </span>
          {disabled && <span className="text-amber-300 shrink-0">Saugoma...</span>}
        </div>
      )}
    </div>
  );
};
