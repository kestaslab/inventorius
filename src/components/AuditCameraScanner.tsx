import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, RefreshCw, AlertTriangle, SwitchCamera, X } from 'lucide-react';
import {
  CameraControllerState,
  CameraVideoElementLike,
  createAuditCameraController,
} from '../utils/cameraController';

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

const INITIAL_CAMERA_STATE: CameraControllerState = {
  status: 'idle',
  errorMessage: null,
  devices: [],
  activeDeviceId: '',
  lastHighlightCode: null,
};

export const AuditCameraScanner: React.FC<AuditCameraScannerProps> = ({
  isOpen,
  disabled = false,
  onDecodedCode,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const disabledRef = useRef<boolean>(disabled);
  const onDecodedRef = useRef(onDecodedCode);
  const barcodeDetectorRef = useRef<NativeBarcodeDetector | null>(null);
  const controllerRef = useRef<ReturnType<typeof createAuditCameraController> | null>(null);

  const [cameraState, setCameraState] = useState<CameraControllerState>(INITIAL_CAMERA_STATE);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    onDecodedRef.current = onDecodedCode;
  }, [onDecodedCode]);

  const getOrCreateController = () => {
    if (!controllerRef.current) {
      controllerRef.current = createAuditCameraController({
        env: {
          isSecureContext: () =>
            typeof window === 'undefined' ? true : Boolean(window.isSecureContext),
          getUserMedia:
            typeof navigator !== 'undefined' &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
              ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
              : undefined,
          enumerateDevices:
            typeof navigator !== 'undefined' &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.enumerateDevices === 'function'
              ? () => navigator.mediaDevices.enumerateDevices()
              : undefined,
          requestFrame: (cb) => requestAnimationFrame(cb),
          cancelFrame: (id) => cancelAnimationFrame(id),
          now: () => Date.now(),
          getVideoElement: () => videoRef.current as unknown as CameraVideoElementLike | null,
          decodeFrame: async (video) => {
            const canvas = canvasRef.current;
            const htmlVideo = video as unknown as HTMLVideoElement;
            if (!canvas || !htmlVideo) return null;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;

            if (canvas.width !== htmlVideo.videoWidth || canvas.height !== htmlVideo.videoHeight) {
              canvas.width = htmlVideo.videoWidth;
              canvas.height = htmlVideo.videoHeight;
            }
            ctx.drawImage(htmlVideo, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (qr?.data?.trim()) {
              return qr.data.trim();
            }

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

            if (barcodeDetectorRef.current) {
              try {
                const detected = await barcodeDetectorRef.current.detect(canvas);
                const first = detected.find((d) => Boolean(d.rawValue?.trim()));
                if (first?.rawValue) {
                  return first.rawValue.trim();
                }
              } catch {
                // ignore detector failure
              }
            }
            return null;
          },
        },
        isDecodingDisabled: () => disabledRef.current,
        onStateChange: (nextState) => setCameraState(nextState),
        onDecodedCode: (raw) => onDecodedRef.current(raw),
      });
    }
    return controllerRef.current;
  };

  useEffect(() => {
    const controller = getOrCreateController();
    if (!isOpen) {
      controller.stop();
      return;
    }

    void controller.start();

    return () => {
      controller.stop();
    };
    // Paleidžiame tik pasikeitus isOpen; kameros perjungimas vykdomas tiesioginiu vartotojo paspaudimu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const { status, errorMessage, devices, lastHighlightCode, activeDeviceId } = cameraState;

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
              onClick={() => void getOrCreateController().switchCamera()}
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
              getOrCreateController().stop();
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
                onClick={() => void getOrCreateController().start(activeDeviceId || undefined)}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-bold cursor-pointer"
              >
                Bandyti dar kartą
              </button>
              <button
                type="button"
                onClick={() => {
                  getOrCreateController().stop();
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
