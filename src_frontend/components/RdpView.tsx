import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Company, UserProfile } from '../types';
import {
  Monitor,
  Plus,
  Play,
  RotateCcw,
  Maximize,
  Minimize,
  Camera,
  AlertTriangle,
  FileText,
  Trash2,
  Lock,
  Server,
  User,
  PowerOff,
  Copy,
  Check,
  Globe,
  Share2,
  X,
  Clock,
  Laptop
} from 'lucide-react';

interface RdpViewProps {
  user?: UserProfile | null;
  company?: Company | null;
}

export interface SavedRdpConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  lastScreenshot?: string | null;
  autoConnect?: boolean;
  sharedWithWorkspace?: boolean;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'webrdp.connections.v1';

const SCANCODE_MAP: Record<string, number> = {
  Escape: 0x01,
  Digit1: 0x02,
  Digit2: 0x03,
  Digit3: 0x04,
  Digit4: 0x05,
  Digit5: 0x06,
  Digit6: 0x07,
  Digit7: 0x08,
  Digit8: 0x09,
  Digit9: 0x0a,
  Digit0: 0x0b,
  Minus: 0x0c,
  Equal: 0x0d,
  Backspace: 0x0e,
  Tab: 0x0f,
  KeyQ: 0x10,
  KeyW: 0x11,
  KeyE: 0x12,
  KeyR: 0x13,
  KeyT: 0x14,
  KeyY: 0x15,
  KeyU: 0x16,
  KeyI: 0x17,
  KeyO: 0x18,
  KeyP: 0x19,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Enter: 0x1c,
  ControlLeft: 0x1d,
  KeyA: 0x1e,
  KeyS: 0x1f,
  KeyD: 0x20,
  KeyF: 0x21,
  KeyG: 0x22,
  KeyH: 0x23,
  KeyJ: 0x24,
  KeyK: 0x25,
  KeyL: 0x26,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  ShiftLeft: 0x2a,
  Backslash: 0x2b,
  KeyZ: 0x2c,
  KeyX: 0x2d,
  KeyC: 0x2e,
  KeyV: 0x2f,
  KeyB: 0x30,
  KeyN: 0x31,
  KeyM: 0x32,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  ShiftRight: 0x36,
  NumpadMultiply: 0x37,
  AltLeft: 0x38,
  Space: 0x39,
  CapsLock: 0x3a,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  NumLock: 0x45,
  ScrollLock: 0x46,
  Numpad7: 0x47,
  Numpad8: 0x48,
  Numpad9: 0x49,
  NumpadSubtract: 0x4a,
  Numpad4: 0x4b,
  Numpad5: 0x4c,
  Numpad6: 0x4d,
  NumpadAdd: 0x4e,
  Numpad1: 0x4f,
  Numpad2: 0x50,
  Numpad3: 0x51,
  Numpad0: 0x52,
  NumpadDecimal: 0x53,
  F11: 0x57,
  F12: 0x58,
  NumpadEnter: 0xe01c,
  ControlRight: 0xe01d,
  NumpadDivide: 0xe035,
  PrintScreen: 0xe037,
  AltRight: 0xe038,
  Home: 0xe047,
  ArrowUp: 0xe048,
  PageUp: 0xe049,
  ArrowLeft: 0xe04b,
  ArrowRight: 0xe04d,
  End: 0xe04f,
  ArrowDown: 0xe050,
  PageDown: 0xe051,
  Insert: 0xe052,
  Delete: 0xe053,
  MetaLeft: 0xe05b,
  MetaRight: 0xe05c,
  ContextMenu: 0xe05d,
  Pause: 0xe11d45,
};

export const RdpView: React.FC<RdpViewProps> = ({ user, company }) => {
  const [connections, setConnections] = useState<SavedRdpConnection[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [statusText, setStatusText] = useState('Disconnected');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');
  const [activeParams, setActiveParams] = useState<{ host: string; port: number; username: string; password?: string } | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('3389');
  const [formUsername, setFormUsername] = useState('Administrator');
  const [formPassword, setFormPassword] = useState('');
  const [formAutoConnect, setFormAutoConnect] = useState(false);
  const [formShareWorkspace, setFormShareWorkspace] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Quick connect bar state
  const [quickHost, setQuickHost] = useState('');
  const [quickUser, setQuickUser] = useState('Administrator');
  const [quickPass, setQuickPass] = useState('');

  // Logs & Freeze Alert States
  const [logs, setLogs] = useState<{ time: string; text: string; type: 'info' | 'warn' | 'error' | 'success' }[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [freezeAlerts, setFreezeAlerts] = useState(true);
  const [isFrozenBanner, setIsFrozenBanner] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);

  // Reconnect state
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<any>(null);
  const wasmModuleRef = useRef<any>(null);
  const userDisconnectedRef = useRef(false);
  const reconnectTimerRef = useRef<any>(null);
  const freezeTimerRef = useRef<any>(null);
  const reconnectAttemptRef = useRef(0);
  const lastSampleRef = useRef<string | null>(null);

  // Append log entry
  const addLog = useCallback((text: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-300), { time, text, type }]);
  }, []);

  // Load saved connections from localStorage
  const loadConnections = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setConnections(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const saveConnectionsToStorage = (updated: SavedRdpConnection[]) => {
    setConnections(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e: any) {
      addLog(`Failed to save connections to browser storage: ${e.message}`, 'error');
    }
  };

  // WASM Initialization
  const ensureWasm = async () => {
    if (wasmModuleRef.current) return wasmModuleRef.current;
    addLog('Loading WebAssembly IronRDP module…', 'info');
    try {
      // @ts-ignore - Dynamically loaded at runtime from /public/pkg/rdp_client.js in browser
      const wasm = await import(/* webpackIgnore: true */ '/pkg/rdp_client.js');
      await wasm.default('/pkg/rdp_client_bg.wasm');
      wasm.setup('info');
      wasmModuleRef.current = wasm;
      addLog('IronRDP WASM module initialized successfully', 'success');
      return wasm;
    } catch (e: any) {
      addLog(`Failed to initialize WASM: ${e.message}`, 'error');
      throw e;
    }
  };

  // Stop freeze watchdog
  const stopFreezeWatchdog = () => {
    if (freezeTimerRef.current) {
      clearInterval(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
    setIsFrozenBanner(false);
  };

  // Start freeze watchdog
  const startFreezeWatchdog = () => {
    stopFreezeWatchdog();
    if (!freezeAlerts) return;

    let staleCount = 0;
    const offscreen = document.createElement('canvas');
    offscreen.width = 32;
    offscreen.height = 18;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    freezeTimerRef.current = setInterval(() => {
      const canvas = canvasRef.current;
      if (!canvas || !offCtx) return;

      try {
        offCtx.drawImage(canvas, 0, 0, 32, 18);
        const imgData = offCtx.getImageData(0, 0, 32, 18);
        let hash = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
          hash = (hash * 31 + imgData.data[i]) | 0;
        }
        const sample = hash.toString();

        if (sample === lastSampleRef.current) {
          staleCount++;
          if (staleCount >= 5) {
            setIsFrozenBanner(true);
          }
          if (staleCount >= 15 && freezeAlerts) {
            addLog('Freeze watchdog detected hung frame: auto-reconnecting session…', 'warn');
            triggerReconnect();
          }
        } else {
          staleCount = 0;
          lastSampleRef.current = sample;
          setIsFrozenBanner(false);
        }
      } catch {
        // ignore
      }
    }, 4000);
  };

  // Connect to Remote Desktop
  const connectToRdp = async (
    params: { host: string; port: number; username: string; password?: string },
    isReconnect = false
  ) => {
    userDisconnectedRef.current = false;
    setActiveParams(params);
    setSessionActive(true);
    setConnectionStatus(isReconnect ? 'reconnecting' : 'connecting');
    setStatusText(isReconnect ? `Reconnecting… (attempt ${reconnectAttemptRef.current})` : 'Connecting…');

    const destination = `${params.host.trim()}:${params.port || 3389}`;
    addLog(`Initiating RDP connection to ${destination} as user "${params.username}"`);

    try {
      const wasm = await ensureWasm();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas element not available');

      // Determine proxy address
      // Connect directly to backend /rdp-ws proxy or node proxy on port 8080
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // In dev/prod, Next.js rewrites /rdp-ws to proxy or Axum bridges it directly
      const proxyAddress = `${protocol}//${window.location.host}/rdp-ws`;
      addLog(`RDCleanPath proxy endpoint: ${proxyAddress}`, 'info');

      const desktopSize = new wasm.DesktopSize(1280, 720);
      const enableCredsspExt = new wasm.Extension('enable_credssp', true);

      const builder = new wasm.SessionBuilder();
      builder.username(params.username);
      builder.password(params.password || '');
      builder.destination(destination);
      builder.proxyAddress(proxyAddress);
      builder.authToken('none');
      builder.desktopSize(desktopSize);
      builder.renderCanvas(canvas);
      builder.extension(enableCredsspExt);

      // Clipboard handling
      if (builder.setClipboardCallback && wasm.ClipboardData) {
        builder.setClipboardDataCallbackContext(canvas);
        builder.setClipboardCallback(async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              const clipData = new wasm.ClipboardData();
              clipData.addText('text/plain', text);
              if (sessionRef.current?.sendClipboardData) {
                sessionRef.current.sendClipboardData(clipData);
              }
            }
          } catch {
            // permission denied or unsupported
          }
        });
      }

      builder.setCursorStyleCallbackContext(canvas);
      builder.setCursorStyleCallback((style: string) => {
        canvas.style.cursor = style || 'default';
      });

      addLog('Performing RDCleanPath handshake & TLS exchange…', 'info');
      const newSession = await builder.connect();
      sessionRef.current = newSession;

      const ds = newSession.desktopSize();
      canvas.width = ds.width;
      canvas.height = ds.height;

      setConnectionStatus('connected');
      setStatusText(`Connected (${ds.width}×${ds.height})`);
      addLog(`Connected! Remote desktop resolution: ${ds.width}x${ds.height}`, 'success');
      canvas.focus();
      reconnectAttemptRef.current = 0;
      setReconnectCountdown(null);

      startFreezeWatchdog();

      newSession
        .run()
        .then((info: any) => {
          addLog(`RDP Session ended: ${info?.reason ? info.reason() : 'Normal closure'}`, 'warn');
          handleSessionClosed();
        })
        .catch((e: any) => {
          addLog(`RDP Session terminated: ${e?.message || e}`, 'error');
          handleSessionClosed();
        });
    } catch (err: any) {
      addLog(`RDP Connection failed: ${err?.message || err}`, 'error');
      handleSessionClosed();
    }
  };

  const handleSessionClosed = () => {
    stopFreezeWatchdog();
    sessionRef.current = null;

    if (userDisconnectedRef.current || !activeParams) {
      setConnectionStatus('disconnected');
      setStatusText('Disconnected');
      return;
    }

    // Auto-reconnect with exponential backoff
    reconnectAttemptRef.current += 1;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 30000);
    setConnectionStatus('reconnecting');
    setStatusText(`Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectAttemptRef.current})`);
    addLog(`Connection dropped. Auto-reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectAttemptRef.current})`, 'warn');

    setReconnectCountdown(Math.round(delay / 1000));
    const countdownInterval = setInterval(() => {
      setReconnectCountdown((prev) => {
        if (!prev || prev <= 1) {
          clearInterval(countdownInterval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      clearInterval(countdownInterval);
      if (activeParams && !userDisconnectedRef.current) {
        connectToRdp(activeParams, true);
      }
    }, delay);
  };

  const disconnect = () => {
    userDisconnectedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    stopFreezeWatchdog();

    if (sessionRef.current) {
      try {
        sessionRef.current.free?.();
      } catch {
        // ignore
      }
      sessionRef.current = null;
    }

    setConnectionStatus('disconnected');
    setStatusText('Disconnected');
    setSessionActive(false);
    setReconnectCountdown(null);
    addLog('User disconnected from remote desktop', 'info');
  };

  const triggerReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    stopFreezeWatchdog();
    if (activeParams) {
      reconnectAttemptRef.current = 1;
      connectToRdp(activeParams, true);
    }
  };

  // Keyboard & Mouse Events on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applyInput = (event: any) => {
      const session = sessionRef.current;
      const wasm = wasmModuleRef.current;
      if (!session || !wasm) return;
      try {
        const tx = new wasm.InputTransaction();
        tx.addEvent(event);
        session.applyInputs(tx);
      } catch {
        // ignore
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const scancode = SCANCODE_MAP[e.code];
      if (scancode !== undefined) {
        applyInput(wasmModuleRef.current.DeviceEvent.keyPressed(scancode));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const scancode = SCANCODE_MAP[e.code];
      if (scancode !== undefined) {
        applyInput(wasmModuleRef.current.DeviceEvent.keyReleased(scancode));
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      applyInput(wasmModuleRef.current.DeviceEvent.mouseMove(x, y));
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      e.preventDefault();
      canvas.focus();
      applyInput(wasmModuleRef.current.DeviceEvent.mouseButtonPressed(e.button));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      e.preventDefault();
      applyInput(wasmModuleRef.current.DeviceEvent.mouseButtonReleased(e.button));
    };

    const handleWheel = (e: WheelEvent) => {
      if (!sessionRef.current || !wasmModuleRef.current) return;
      e.preventDefault();
      applyInput(wasmModuleRef.current.DeviceEvent.wheelRotations(true, e.deltaY > 0 ? 1 : -1, 0));
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      canvas.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [sessionActive]);

  // Special key helpers
  const sendCtrlAltDel = () => {
    const wasm = wasmModuleRef.current;
    if (!sessionRef.current || !wasm) return;
    try {
      const tx = new wasm.InputTransaction();
      tx.addEvent(wasm.DeviceEvent.keyPressed(SCANCODE_MAP['ControlLeft']));
      tx.addEvent(wasm.DeviceEvent.keyPressed(SCANCODE_MAP['AltLeft']));
      tx.addEvent(wasm.DeviceEvent.keyPressed(SCANCODE_MAP['Delete']));
      tx.addEvent(wasm.DeviceEvent.keyReleased(SCANCODE_MAP['Delete']));
      tx.addEvent(wasm.DeviceEvent.keyReleased(SCANCODE_MAP['AltLeft']));
      tx.addEvent(wasm.DeviceEvent.keyReleased(SCANCODE_MAP['ControlLeft']));
      sessionRef.current.applyInputs(tx);
      addLog('Sent Ctrl+Alt+Del signal to remote machine', 'info');
    } catch (err: any) {
      addLog(`Failed to send key combo: ${err.message}`, 'error');
    }
  };

  const takeScreenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `rdp-screenshot-${Date.now()}.png`;
      a.click();
      addLog('Captured and downloaded remote desktop screenshot', 'success');
    } catch {
      // ignore
    }
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!document.fullscreenElement) {
      stage.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Form submit (create or update connection)
  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formHost.trim()) return;

    const now = Date.now();
    const port = parseInt(formPort, 10) || 3389;

    if (editingId) {
      const updated = connections.map((c) =>
        c.id === editingId
          ? {
              ...c,
              name: formName.trim() || `${formHost}:${port}`,
              host: formHost.trim(),
              port,
              username: formUsername.trim(),
              password: formPassword || c.password,
              autoConnect: formAutoConnect,
              sharedWithWorkspace: formShareWorkspace,
              updatedAt: now,
            }
          : c
      );
      saveConnectionsToStorage(updated);
      addLog(`Updated connection "${formName || formHost}"`, 'success');
    } else {
      const newConn: SavedRdpConnection = {
        id: `rdp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: formName.trim() || `${formHost}:${port}`,
        host: formHost.trim(),
        port,
        username: formUsername.trim(),
        password: formPassword,
        autoConnect: formAutoConnect,
        sharedWithWorkspace: formShareWorkspace,
        createdAt: now,
        updatedAt: now,
      };
      saveConnectionsToStorage([...connections, newConn]);
      addLog(`Saved new connection "${newConn.name}" (${newConn.host}:${newConn.port})`, 'success');
    }

    setShowModal(false);
    resetForm();
  };

  const resetForm = () => {
    setEditingId(null);
    setFormName('');
    setFormHost('');
    setFormPort('3389');
    setFormUsername('Administrator');
    setFormPassword('');
    setFormAutoConnect(false);
    setFormShareWorkspace(false);
  };

  const deleteConnection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = connections.filter((c) => c.id !== id);
    saveConnectionsToStorage(updated);
    addLog('Removed saved connection', 'info');
  };

  const copyLogsToClipboard = () => {
    const text = logs.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F8F9FB] select-none overflow-hidden font-sans relative">
      {/* Top Header Bar */}
      <header className="px-6 py-4 bg-white border-b border-black/[0.04] flex items-center justify-between shrink-0 shadow-sm z-20">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/60 flex items-center justify-center text-indigo-600 shadow-sm">
            <Monitor className="w-5 h-5 stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight">Shared Desktop RDP</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                WebRDP IronRDP WASM
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-normal">
              Direct, plugin-free Windows Remote Desktop in your browser.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {sessionActive && (
            <>
              {/* Status Pill */}
              <div
                className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-2 border transition-all ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                    ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectionStatus === 'connected'
                      ? 'bg-emerald-500'
                      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                      ? 'bg-amber-500 animate-ping'
                      : 'bg-slate-400'
                  }`}
                />
                <span className="text-[11px] font-bold">{statusText}</span>
              </div>

              {/* Special Keys */}
              <button
                onClick={sendCtrlAltDel}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all border border-slate-200 shadow-sm"
                title="Send Ctrl+Alt+Del"
              >
                Ctrl+Alt+Del
              </button>

              {/* Screenshot */}
              <button
                onClick={takeScreenshot}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all border border-slate-200 shadow-sm"
                title="Take Screenshot"
              >
                <Camera className="w-4 h-4" />
              </button>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all border border-slate-200 shadow-sm"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              {/* Disconnect */}
              <button
                onClick={disconnect}
                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold transition-all border border-rose-200 flex items-center space-x-1.5 shadow-sm"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          )}

          {/* Toggle Log Panel */}
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={`p-2 rounded-xl transition-all border shadow-sm ${
              showLogs ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
            }`}
            title="Activity Logs"
          >
            <FileText className="w-4 h-4" />
          </button>

          {!sessionActive && (
            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              <span>New Connection</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* VIEW 1: ACTIVE LIVE SESSION */}
        <div
          ref={stageRef}
          className={`flex-1 flex flex-col bg-slate-950 relative overflow-hidden items-center justify-center ${
            sessionActive ? 'flex' : 'hidden'
          }`}
        >
          {/* Reconnect Banner */}
          {connectionStatus === 'reconnecting' && (
            <div className="absolute top-4 z-30 px-5 py-2.5 bg-amber-500/90 text-slate-950 font-bold text-xs rounded-2xl shadow-xl flex items-center space-x-3 backdrop-blur-md animate-in slide-in-from-top">
              <RotateCcw className="w-4 h-4 animate-spin" />
              <span>
                Disconnected. Auto-reconnecting {reconnectCountdown ? `in ${reconnectCountdown}s…` : 'now…'}
              </span>
              <button
                onClick={triggerReconnect}
                className="px-2.5 py-1 bg-slate-950 text-white rounded-lg text-[10px] hover:bg-slate-900 transition-colors"
              >
                Reconnect Now
              </button>
            </div>
          )}

          {/* Freeze Alert Banner */}
          {isFrozenBanner && (
            <div className="absolute top-16 z-30 px-4 py-2 bg-rose-600 text-white text-xs font-semibold rounded-2xl shadow-xl flex items-center space-x-2 animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              <span>Session frame appears frozen.</span>
              <button
                onClick={triggerReconnect}
                className="underline font-bold hover:text-slate-200 ml-1"
              >
                Reconnect frame
              </button>
            </div>
          )}

          {/* Active Canvas Display */}
          <canvas
            ref={canvasRef}
            id="rdp-screen"
            tabIndex={0}
            className="max-w-full max-h-full object-contain shadow-2xl focus:outline-none cursor-default"
          />
        </div>

        {/* VIEW 2: DASHBOARD & CONNECTIONS MANAGEMENT */}
        {!sessionActive && (
          <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8 max-w-7xl mx-auto w-full">
            {/* Quick Connect Bar */}
            <section className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center space-x-2 text-slate-900 font-bold text-xs uppercase tracking-wider">
                <Globe className="w-4 h-4 text-indigo-600" />
                <span>Instant Quick Connect</span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!quickHost.trim()) return;
                  const [host, portStr] = quickHost.split(':');
                  const port = portStr ? parseInt(portStr, 10) : 3389;
                  connectToRdp({
                    host,
                    port,
                    username: quickUser.trim() || 'Administrator',
                    password: quickPass,
                  });
                }}
                className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center"
              >
                <div className="relative">
                  <Server className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Host (e.g. 192.168.1.50 or rdp.domain.com)"
                    value={quickHost}
                    onChange={(e) => setQuickHost(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                  />
                </div>

                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Username (e.g. Administrator)"
                    value={quickUser}
                    onChange={(e) => setQuickUser(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    placeholder="Password (optional)"
                    value={quickPass}
                    onChange={(e) => setQuickPass(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                  />
                </div>

                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all shadow-md shadow-slate-900/10"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Connect Directly</span>
                </button>
              </form>
            </section>

            {/* Saved Remote Desktop Connections Grid */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Saved Remote Desktops</h2>
                  <p className="text-xs text-slate-400">
                    {connections.length === 0
                      ? 'No saved remote desktops yet. Add one or use Quick Connect.'
                      : `${connections.length} saved remote connection${connections.length === 1 ? '' : 's'}`}
                  </p>
                </div>

                {connections.length > 0 && (
                  <button
                    onClick={() => {
                      resetForm();
                      setShowModal(true);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add New</span>
                  </button>
                )}
              </div>

              {connections.length === 0 ? (
                <div className="p-12 bg-white rounded-3xl border border-slate-200/80 text-center flex flex-col items-center justify-center space-y-3 shadow-sm">
                  <div className="w-14 h-14 rounded-3xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-1">
                    <Laptop className="w-7 h-7 stroke-[1.5]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Remote Connections Configured</h3>
                  <p className="text-xs text-slate-400 max-w-sm">
                    Connect directly using the quick connect bar above, or save commonly used enterprise Windows servers for one-click access.
                  </p>
                  <button
                    onClick={() => {
                      resetForm();
                      setShowModal(true);
                    }}
                    className="mt-2 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-2 transition-all shadow-md shadow-indigo-600/20"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add First Remote Desktop</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {connections.map((c) => (
                    <div
                      key={c.id}
                      className="bg-white rounded-3xl p-5 border border-slate-200/80 hover:border-indigo-200 hover:shadow-md transition-all flex flex-col justify-between group"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-2xl bg-slate-100 group-hover:bg-indigo-50 text-slate-600 group-hover:text-indigo-600 flex items-center justify-center transition-colors">
                              <Monitor className="w-5 h-5 stroke-[1.8]" />
                            </div>
                            <div>
                              <h3 className="text-xs font-bold text-slate-900 truncate max-w-[170px]">{c.name}</h3>
                              <p className="text-[11px] text-slate-400 font-mono truncate">{c.host}:{c.port}</p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              onClick={(e) => deleteConnection(c.id, e)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                          <div className="flex items-center space-x-1">
                            <User className="w-3 h-3 text-slate-400" />
                            <span className="font-semibold text-slate-700">{c.username}</span>
                          </div>

                          {c.sharedWithWorkspace && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 flex items-center gap-1">
                              <Share2 className="w-2.5 h-2.5" />
                              Workspace
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(c.updatedAt).toLocaleDateString()}
                        </span>

                        <button
                          onClick={() => {
                            connectToRdp({
                              host: c.host,
                              port: c.port,
                              username: c.username,
                              password: c.password,
                            });
                          }}
                          className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-indigo-600 text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Connect</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Features & Architecture Information Card */}
            <section className="bg-slate-900 text-white rounded-3xl p-6 lg:p-8 space-y-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Native Windows RDP Client inside TheySynced</h3>
                  <p className="text-xs text-slate-400">Powered by IronRDP WASM & TLS RDCleanPath Relay</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-800 space-y-1">
                  <div className="font-bold text-slate-200">Zero Client Plugins</div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">Runs pure WebAssembly compiled Rust directly in your modern browser with canvas rendering.</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-800 space-y-1">
                  <div className="font-bold text-slate-200">RDCleanPath Handshake</div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">Automated X.224 negotiation, TLS self-signed cert extraction, and bidirectional WebSocket streaming.</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-800 space-y-1">
                  <div className="font-bold text-slate-200">Persistent Watchdog</div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">Auto-reconnection backoff, freeze frame detection, clipboard syncing, and native scancode input.</p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Connection Creation / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Monitor className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {editingId ? 'Edit Connection' : 'New Remote Desktop Connection'}
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConnection} className="space-y-4 pt-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Connection Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Windows Server"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Host / IP *
                  </label>
                  <input
                    type="text"
                    placeholder="192.168.1.100"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  placeholder="Administrator"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Password (Optional)
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium transition-all"
                />
              </div>

              <div className="pt-2 space-y-2">
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formShareWorkspace}
                    onChange={(e) => setFormShareWorkspace(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Share connection across company workspace members</span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
                >
                  Save Connection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activity Logs Drawer */}
      {showLogs && (
        <div className="absolute right-4 bottom-4 z-40 w-96 max-w-[90vw] bg-slate-900/95 backdrop-blur-md text-white rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col h-80 animate-in slide-in-from-bottom-5">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center space-x-2">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs font-bold text-slate-200">RDP Activity Logs</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={copyLogsToClipboard}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Copy logs"
              >
                {copiedLog ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setLogs([])}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Clear logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowLogs(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] space-y-1.5 select-text">
            {logs.length === 0 ? (
              <div className="text-slate-500 italic text-center py-8">No logs recorded yet.</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="flex items-start space-x-2 leading-tight">
                  <span className="text-slate-500 shrink-0">[{l.time}]</span>
                  <span
                    className={`${
                      l.type === 'error'
                        ? 'text-rose-400 font-semibold'
                        : l.type === 'warn'
                        ? 'text-amber-400'
                        : l.type === 'success'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-slate-300'
                    }`}
                  >
                    {l.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
