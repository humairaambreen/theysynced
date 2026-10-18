'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { Terminal as TerminalIcon, RotateCcw, Power, ShieldCheck, Check } from 'lucide-react';
import { buildCompanyLinuxFilesystem } from '../lib/linuxFilesystem';
import 'xterm/css/xterm.css';

interface SharedTerminalViewProps {
  user: UserProfile;
  company: Company;
  teams: Team[];
  chatMessages: ChatMessage[];
  assets: WorkspaceAsset[];
  websocket: WebSocket | null;
  onSaveAsset: (asset: Partial<WorkspaceAsset>) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onNavigateTab?: (tab: ActiveTab, subItem?: string) => void;
  initialPath?: string;
}

// Dynamically load browser-safe v86 WebAssembly emulator script
function loadV86Script(): Promise<any> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if ((window as any).V86) return resolve((window as any).V86);

    const existing = document.querySelector('script[src="/v86/libv86.js"]');
    if (existing) {
      if ((window as any).V86) return resolve((window as any).V86);
      existing.addEventListener('load', () => resolve((window as any).V86));
      existing.addEventListener('error', () => resolve(null));
      return;
    }

    const script = document.createElement('script');
    script.src = '/v86/libv86.js';
    script.async = true;
    script.onload = () => resolve((window as any).V86);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export const SharedTerminalView: React.FC<SharedTerminalViewProps> = ({
  user,
  company,
  teams,
  chatMessages,
  assets,
  websocket,
  onSaveAsset,
  onDeleteAsset,
  onNavigateTab,
  initialPath = '/workspace',
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  const [engineStatus, setEngineStatus] = useState<string>('Connecting to Real Linux PTY...');
  const [isLive, setIsLive] = useState<boolean>(false);

  const ptyWsRef = useRef<WebSocket | null>(null);
  const v86InstanceRef = useRef<any>(null);
  const activeModeRef = useRef<'pty' | 'wasm' | 'none'>('none');

  const hostname = useMemo(() => {
    const slug = (company.name || 'theysynced')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'theysynced';
    return `arch-${slug}`;
  }, [company.name]);

  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Boot Real WebAssembly Linux Kernel (Linux 5.6.15 Buildroot)
  const bootWasmKernel = async (term: any) => {
    try {
      setEngineStatus('Booting Real Linux Kernel in WASM (v5.6.15)...');
      term.writeln('\x1b[1;36mInitializing Real Linux x86 WebAssembly Emulator (v86)...\x1b[0m');
      term.writeln('Kernel: \x1b[33mLinux 5.6.15-buildroot\x1b[0m | Console: \x1b[32m/dev/ttyS0\x1b[0m');
      term.writeln('Streaming kernel binary (4.9MB) and starting emulator...\r\n');

      const V86Class = await loadV86Script();

      if (!V86Class) {
        term.writeln('\x1b[31mError: v86 WebAssembly engine script could not be loaded.\x1b[0m');
        setEngineStatus('WASM Engine Error');
        return;
      }

      if (v86InstanceRef.current) {
        try {
          v86InstanceRef.current.destroy();
        } catch (_) {}
      }

      const emulator = new V86Class({
        wasm_path: '/v86/v86.wasm',
        memory_size: 64 * 1024 * 1024,
        bios: { url: '/v86/seabios.bin' },
        vga_bios: { url: '/v86/vgabios.bin' },
        bzimage: { url: '/v86/buildroot-bzimage.bin' },
        cmdline: 'console=ttyS0 root=/dev/ram0 rw quiet',
        filesystem: {},
        autostart: true,
      });

      v86InstanceRef.current = emulator;
      activeModeRef.current = 'wasm';
      setIsLive(true);
      setEngineStatus('Real Linux Kernel 5.6.15 (WASM)');

      // Stream serial output bytes directly from Linux kernel to xterm.js
      emulator.add_listener('serial0-output-byte', (byte: number) => {
        term.write(String.fromCharCode(byte));
      });

      // Mount all company workspace assets into the 9p filesystem (/mnt)
      const enc = new TextEncoder();
      for (const entry of linuxEntries) {
        if (entry.type === 'file' && entry.content) {
          const cleanName = entry.path.replace(/^\/workspace\//, '').replace(/\//g, '_');
          try {
            await emulator.create_file(cleanName, enc.encode(entry.content));
          } catch (_) {}
        }
      }

      // Link /mnt to /workspace inside the Linux VM once the kernel shell is ready
      let mounted = false;
      setTimeout(() => {
        if (!mounted && v86InstanceRef.current) {
          mounted = true;
          v86InstanceRef.current.serial0_send('mkdir -p /workspace && cd /workspace && ln -sf /mnt/* . 2>/dev/null; cd ~\n');
        }
      }, 3500);

      term.writeln('\x1b[32m✓ Real Linux Kernel running directly in WebAssembly.\x1b[0m\r\n');
    } catch (err: any) {
      term.writeln(`\r\n\x1b[31mFailed to boot WASM Linux kernel: ${err.message}\x1b[0m\r\n`);
      setEngineStatus('WASM Boot Error');
    }
  };

  // Connect to Real Rust PTY WebSocket
  const tryConnectPty = (term: any): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        const loc = window.location;
        let wsHost = loc.host;
        // In local development, Next.js frontend is on 3000 while Rust backend is on 8000
        if (loc.port === '3000') {
          wsHost = `${loc.hostname}:8000`;
        }
        const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        const cols = term?.cols || 100;
        const rows = term?.rows || 30;
        const uname = encodeURIComponent(user?.username || 'user');
        const wsUrl = `${wsProto}//${wsHost}/ws/terminal?username=${uname}&cols=${cols}&rows=${rows}`;

        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 1800);

        ws.onopen = () => {
          clearTimeout(timeout);
          ptyWsRef.current = ws;
          activeModeRef.current = 'pty';
          setIsLive(true);
          setEngineStatus('Real Linux Container PTY (Native)');
          term.writeln('\x1b[1;32m✓ Connected to Native Linux / POSIX PTY Session\x1b[0m');
          term.writeln(`Host: \x1b[1;36m${hostname}\x1b[0m | User: \x1b[1;33m${user.username}\x1b[0m | Full Native Process Execution\r\n`);
          resolve(true);
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data));
          } else if (typeof event.data === 'string') {
            term.write(event.data);
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };

        ws.onclose = () => {
          if (activeModeRef.current === 'pty') {
            term.writeln('\r\n\x1b[33m[PTY Session Closed. Switching to Real WebAssembly Linux Kernel...]\x1b[0m\r\n');
            activeModeRef.current = 'wasm';
            bootWasmKernel(term);
          }
        };
      } catch {
        resolve(false);
      }
    });
  };

  // Mount xterm.js and initialize real execution engine
  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;

    const init = async () => {
      if (!terminalRef.current) return;
      terminalRef.current.innerHTML = '';

      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
        lineHeight: 1.25,
        theme: {
          background: '#0a0d14',
          foreground: '#e2e8f0',
          cursor: '#38bdf8',
          selectionBackground: '#1e293b',
          black: '#0f172a',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#38bdf8',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#eab308',
          brightBlue: '#3b82f6',
          brightMagenta: '#a855f7',
          brightCyan: '#06b6d4',
          brightWhite: '#ffffff',
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      xtermInstance.current = term;
      fitAddonRef.current = fitAddon;

      // Handle Native Clipboard copy (Cmd+C / Ctrl+C) and paste (Cmd+V / Ctrl+V)
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
          if (term.hasSelection()) {
            navigator.clipboard.writeText(term.getSelection());
            return false;
          }
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (activeModeRef.current === 'pty' && ptyWsRef.current?.readyState === WebSocket.OPEN) {
              ptyWsRef.current.send(text);
            } else if (activeModeRef.current === 'wasm' && v86InstanceRef.current) {
              v86InstanceRef.current.serial0_send(text);
            }
          });
          return false;
        }

        return true;
      });

      // Forward keyboard input directly to the active real engine
      term.onData((data: string) => {
        if (activeModeRef.current === 'pty' && ptyWsRef.current?.readyState === WebSocket.OPEN) {
          ptyWsRef.current.send(data);
        } else if (activeModeRef.current === 'wasm' && v86InstanceRef.current) {
          v86InstanceRef.current.serial0_send(data);
        }
      });

      // Synchronize terminal dimensions with native PTY master on dynamic resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (activeModeRef.current === 'pty' && ptyWsRef.current?.readyState === WebSocket.OPEN) {
          ptyWsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      // Step 1: Try native Rust PTY WebSocket (0ms native processes, pacman, apt, fish)
      const ptyConnected = await tryConnectPty(term);

      // Step 2: Fall back to real WebAssembly Linux Kernel if PTY is not hosted
      if (!ptyConnected) {
        await bootWasmKernel(term);
      }
    };

    init();

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
        if (activeModeRef.current === 'pty' && ptyWsRef.current?.readyState === WebSocket.OPEN && xtermInstance.current) {
          ptyWsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xtermInstance.current.cols,
            rows: xtermInstance.current.rows,
          }));
        }
      } catch (_) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (ptyWsRef.current) {
        ptyWsRef.current.close();
        ptyWsRef.current = null;
      }
      if (v86InstanceRef.current) {
        try {
          v86InstanceRef.current.destroy();
        } catch (_) {}
        v86InstanceRef.current = null;
      }
      if (term) {
        try {
          term.dispose();
        } catch (_) {}
      }
    };
  }, []);

  const handleRestart = () => {
    if (xtermInstance.current) {
      xtermInstance.current.clear();
      if (activeModeRef.current === 'wasm') {
        bootWasmKernel(xtermInstance.current);
      } else {
        tryConnectPty(xtermInstance.current);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0d14] text-slate-100 font-sans select-none overflow-hidden">
      {/* Clean Header with Engine Status Badge */}
      <div className="bg-[#10141d] border-b border-white/10 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
            <TerminalIcon className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-white text-xs tracking-wide">Linux Terminal</span>
          <span className="text-slate-500 text-xs">&bull;</span>
          <span className="text-slate-400 text-xs font-mono">{hostname}</span>

          <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/10 text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300 font-medium">{engineStatus}</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleRestart}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-white/10 text-xs transition"
            title="Restart Terminal Session"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div 
        ref={terminalRef} 
        className="flex-1 w-full h-full bg-[#0a0d14] p-3 overflow-hidden select-text"
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};
