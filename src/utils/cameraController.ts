import { getAuditCameraErrorMessage } from './auditUtils';

export type CameraStatus = 'idle' | 'starting' | 'active' | 'error';

export interface CameraDeviceSummary {
  deviceId: string;
  label: string;
}

export interface CameraStreamTrackLike {
  stop: () => void;
  getSettings?: () => { deviceId?: string };
}

export interface CameraStreamLike {
  getTracks: () => CameraStreamTrackLike[];
  getVideoTracks: () => CameraStreamTrackLike[];
}

export interface CameraVideoElementLike {
  srcObject: unknown;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  setAttribute?: (name: string, value: string) => void;
  play?: () => Promise<void>;
  pause?: () => void;
}

export interface CameraControllerState {
  status: CameraStatus;
  errorMessage: string | null;
  devices: CameraDeviceSummary[];
  activeDeviceId: string;
  lastHighlightCode: string | null;
}

export interface AuditCameraEnvironment {
  isSecureContext?: () => boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<CameraStreamLike>;
  enumerateDevices?: () => Promise<Array<{ deviceId: string; kind: string; label?: string }>>;
  requestFrame: (cb: (ts: number) => void) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  getVideoElement: () => CameraVideoElementLike | null;
  decodeFrame: (video: CameraVideoElementLike) => Promise<string | null>;
}

export interface AuditCameraControllerOptions {
  env: AuditCameraEnvironment;
  isDecodingDisabled?: () => boolean;
  scanIntervalMs?: number;
  duplicateCooldownMs?: number;
  onStateChange: (state: CameraControllerState) => void;
  onDecodedCode: (rawText: string) => void;
}

function stopStreamTracksOnly(stream: CameraStreamLike | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore track cleanup error
    }
  }
}

export function createAuditCameraController(options: AuditCameraControllerOptions) {
  const {
    env,
    isDecodingDisabled = () => false,
    scanIntervalMs = 120,
    duplicateCooldownMs = 2500,
    onStateChange,
    onDecodedCode,
  } = options;

  let activeRunId = 0;
  let stopped = true;
  let currentStream: CameraStreamLike | null = null;
  let rafId: number | null = null;
  let lastFrameScanAt = 0;
  let lastScanned: { value: string; timestamp: number } | null = null;

  let state: CameraControllerState = {
    status: 'idle',
    errorMessage: null,
    devices: [],
    activeDeviceId: '',
    lastHighlightCode: null,
  };

  const emitState = (patch: Partial<CameraControllerState>) => {
    state = { ...state, ...patch };
    onStateChange(state);
  };

  const isRunCurrent = (runId: number) => !stopped && runId === activeRunId;

  const stopActiveResources = () => {
    if (rafId !== null) {
      env.cancelFrame(rafId);
      rafId = null;
    }
    if (currentStream) {
      stopStreamTracksOnly(currentStream);
      currentStream = null;
    }
    const videoEl = env.getVideoElement();
    if (videoEl) {
      try {
        videoEl.pause?.();
      } catch {
        // ignore pause failure
      }
      videoEl.srcObject = null;
    }
  };

  const stop = () => {
    activeRunId += 1;
    stopped = true;
    stopActiveResources();
    emitState({
      status: 'idle',
      errorMessage: null,
      lastHighlightCode: null,
    });
  };

  const scheduleNextFrame = (runId: number) => {
    if (!isRunCurrent(runId) || !currentStream) return;
    rafId = env.requestFrame((ts) => {
      void runScanTick(runId, ts);
    });
  };

  const runScanTick = async (runId: number, timestamp: number) => {
    if (!isRunCurrent(runId) || !currentStream) return;

    if (timestamp - lastFrameScanAt >= scanIntervalMs) {
      lastFrameScanAt = timestamp;
      const video = env.getVideoElement();

      if (
        video &&
        video.readyState >= 2 && // HTMLMediaElement.HAVE_CURRENT_DATA
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !isDecodingDisabled()
      ) {
        let decodedValue: string | null = null;
        try {
          decodedValue = await env.decodeFrame(video);
        } catch {
          decodedValue = null;
        }

        // Po asinchroninio dekodavimo dar kartą patikriname, ar šis paleidimas nebuvo uždarytas ar pakeistas
        if (!isRunCurrent(runId) || !currentStream) {
          return;
        }

        if (decodedValue && decodedValue.trim() && !isDecodingDisabled()) {
          const clean = decodedValue.trim();
          const nowTs = env.now();
          const normalizedKey = clean.toUpperCase();
          const isDuplicate =
            lastScanned &&
            lastScanned.value === normalizedKey &&
            nowTs - lastScanned.timestamp < duplicateCooldownMs;

          if (!isDuplicate) {
            lastScanned = { value: normalizedKey, timestamp: nowTs };
            emitState({ lastHighlightCode: clean });
            onDecodedCode(clean);
          }
        }
      }
    }

    scheduleNextFrame(runId);
  };

  const start = async (preferredDeviceId?: string): Promise<void> => {
    const runId = ++activeRunId;
    stopped = false;
    stopActiveResources();

    if (!env.getUserMedia) {
      const secure = env.isSecureContext ? env.isSecureContext() : true;
      emitState({
        status: 'error',
        errorMessage: !secure
          ? 'Kamera naršyklėje veikia tik per saugų HTTPS ryšį arba localhost adresą. Naudokite rankinį įvedimą arba USB skaitytuvą.'
          : 'Ši naršyklė arba įrenginys nepalaiko kameros prieigos. Naudokite rankinį kodo įvedimą arba USB skaitytuvą.',
      });
      return;
    }

    emitState({
      status: 'starting',
      errorMessage: null,
      ...(preferredDeviceId ? { activeDeviceId: preferredDeviceId } : {}),
    });

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

      let stream: CameraStreamLike;
      try {
        stream = await env.getUserMedia({
          video: videoConstraint,
          audio: false,
        });
      } catch (firstErr) {
        if (!isRunCurrent(runId)) {
          return;
        }
        if (!preferredDeviceId) {
          stream = await env.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }

      // Jei skaitytuvas jau uždarytas arba perjungtas į kitą kamerą, kol laukėme getUserMedia ->
      // sustabdome TIK šį pavėluotą srautą ir neliečiame naujesnio paleidimo būsenos.
      if (!isRunCurrent(runId)) {
        stopStreamTracksOnly(stream);
        return;
      }

      currentStream = stream;

      const videoEl = env.getVideoElement();
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.setAttribute?.('playsinline', 'true');
        await videoEl.play?.().catch(() => {
          // Kai kurios mobilios naršyklės paleidžia tik po metadata
        });
      }

      if (!isRunCurrent(runId)) {
        stopActiveResources();
        return;
      }

      if (env.enumerateDevices) {
        try {
          const allDevices = await env.enumerateDevices();
          if (!isRunCurrent(runId)) {
            return;
          }
          const videoInputs: CameraDeviceSummary[] = allDevices
            .filter((d) => d.kind === 'videoinput')
            .map((d, idx) => ({
              deviceId: d.deviceId,
              label: d.label || `Kamera ${idx + 1}`,
            }));

          const activeTrack = stream.getVideoTracks()[0];
          const activeId = activeTrack?.getSettings?.().deviceId;
          let resolvedDeviceId = activeId || preferredDeviceId || state.activeDeviceId;
          if (!resolvedDeviceId && videoInputs.length > 0) {
            const rear = videoInputs.find((d) => /back|rear|environment|galin/i.test(d.label));
            resolvedDeviceId = (rear || videoInputs[0]).deviceId;
          }

          emitState({
            devices: videoInputs,
            activeDeviceId: resolvedDeviceId || '',
          });
        } catch {
          // enumerateDevices pasirinktinis
        }
      }

      if (!isRunCurrent(runId) || currentStream !== stream) {
        return;
      }

      emitState({ status: 'active', errorMessage: null });
      scheduleNextFrame(runId);
    } catch (err) {
      // Pavėluota seno paleidimo klaida negali perrašyti naujos kameros ar uždarytos būsenos
      if (!isRunCurrent(runId)) {
        return;
      }
      stopActiveResources();
      emitState({
        status: 'error',
        errorMessage: getAuditCameraErrorMessage(err),
      });
    }
  };

  const switchCamera = async (): Promise<void> => {
    if (state.devices.length < 2) return;
    const currentIndex = state.devices.findIndex((d) => d.deviceId === state.activeDeviceId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % state.devices.length;
    const nextDeviceId = state.devices[nextIndex].deviceId;
    await start(nextDeviceId);
  };

  return {
    start,
    stop,
    switchCamera,
    getState: () => state,
    getActiveRunId: () => activeRunId,
    hasActiveStream: () => Boolean(currentStream),
  };
}
