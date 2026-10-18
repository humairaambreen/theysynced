'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, RotateCcw, 
  Check, Copy, Sparkles, Cpu, Radio, Clipboard, 
  Monitor, Layers, RefreshCw, Power, Wifi
} from 'lucide-react';
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

export type TerminalEngine = 'arch-vm' | 'linux-vm' | 'cotton-os' | 'native-pty';

// Dynamically load v86 emulator script into browser
function loadV86Script(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as any).V86) return resolve();

    const existing = document.querySelector('script[src="/v86/libv86.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }

    const script = document.createElement('script');
    script.src = '/v86/libv86.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
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
  const screenRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const v86EmulatorRef = useRef<any>(null);
  const ptySocketRef = useRef<WebSocket | null>(null);

  // Active Execution Engine
  const [engine, setEngine] = useState<TerminalEngine>('arch-vm');
  const [vmStatus, setVmStatus] = useState<'initializing' | 'booting' | 'running' | 'error' | 'disconnected'>('initializing');
  const [statusMessage, setStatusMessage] = useState<string>('Initializing x86 Virtual Machine...');
  const [cottonDisplayMode, setCottonDisplayMode] = useState<'console' | 'gui'>('console');
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [networkConnected, setNetworkConnected] = useState<boolean>(true);

  // Initialize and Boot the Selected Real Engine
  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;
    let isCancelled = false;

    // Cleanup any running VM or PTY instance
    if (v86EmulatorRef.current) {
      try {
        v86EmulatorRef.current.destroy();
      } catch (_) {}
      v86EmulatorRef.current = null;
    }
    if (ptySocketRef.current) {
      try {
        ptySocketRef.current.close();
      } catch (_) {}
      ptySocketRef.current = null;
    }

    const startTerminal = async () => {
      if (!terminalRef.current) return;
      terminalRef.current.innerHTML = '';

      // Load xterm.js dynamically in browser
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      if (isCancelled) return;

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

      // ── MODE A: NATIVE RUST PTY SOCKET ─────────────────────────────────────
      if (engine === 'native-pty') {
        setVmStatus('booting');
        setStatusMessage('Connecting to Real Native Host PTY (Rust Axum Engine)...');
        term.writeln('\x1b[1;36m==> Connecting to Native Host PTY Shell (/ws/terminal)...\x1b[0m');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/terminal`;
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        ptySocketRef.current = socket;

        socket.onopen = () => {
          setVmStatus('running');
          setStatusMessage('Connected to Native Host PTY Shell');
          term.writeln('\x1b[1;32m✓ Connected to Real Host Shell (Zero Emulation • Full POSIX Access)\x1b[0m\r\n');
        };

        socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const decoded = new TextDecoder().decode(event.data);
            term.write(decoded);
          } else if (typeof event.data === 'string') {
            term.write(event.data);
          }
        };

        socket.onclose = () => {
          setVmStatus('disconnected');
          setStatusMessage('Host PTY Disconnected');
          term.writeln('\r\n\x1b[1;33m[Host PTY connection closed. Use Real Arch Linux VM or Real Linux Kernel VM for 100% in-browser execution.]\x1b[0m');
        };

        socket.onerror = () => {
          setVmStatus('error');
          setStatusMessage('Host PTY connection error');
          term.writeln('\r\n\x1b[1;31m[Cannot connect to host /ws/terminal. Switch to "Arch Linux VM" or "Linux Kernel VM" to run in WebAssembly!]\x1b[0m');
        };

        // Forward all raw keystrokes straight to the PTY
        term.onData((data: string) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
          }
        });

        return;
      }

      // ── MODE B: REAL WEBASSEMBLY VIRTUAL MACHINE (v86) ─────────────────────
      setVmStatus('booting');
      setStatusMessage('Loading x86 Virtual Machine & BIOS...');

      term.writeln('\x1b[1;36m==> Initializing Real x86 Hardware Emulation in WebAssembly (v86)...\x1b[0m');
      term.writeln('\x1b[0;37mEngine: True x86 PC Emulator in WebAssembly • Zero JavaScript command mocks\x1b[0m');

      try {
        await loadV86Script();
        if (isCancelled) return;

        const V86 = (window as any).V86;
        if (!V86) {
          throw new Error('v86 WebAssembly emulator runtime failed to load');
        }

        let vmConfig: any = {
          wasm_path: '/v86/v86.wasm',
          memory_size: 128 * 1024 * 1024,
          vga_memory_size: 8 * 1024 * 1024,
          bios: { url: '/v86/seabios.bin' },
          vga_bios: { url: '/v86/vgabios.bin' },
          net_device: {
            type: 'virtio',
            relay_url: 'wss://relay.widgetry.org/',
          },
          autostart: true,
        };

        if (engine === 'arch-vm') {
          term.writeln('\x1b[1;32m==> Resuming Real Arch Linux VM (pacman enabled, network relay active)...\x1b[0m');
          term.writeln('\x1b[0;36mNetwork: Virtual Ethernet -> wss://relay.widgetry.org/ (Real Internet Access)\x1b[0m\r\n');
          vmConfig = {
            ...vmConfig,
            memory_size: 512 * 1024 * 1024,
            state: { url: '/v86/arch_state-v3.bin.zst' },
          };
        } else if (engine === 'linux-vm') {
          term.writeln('\x1b[1;32m==> Booting Real Linux Kernel (Buildroot bzImage 6.x)...\x1b[0m');
          term.writeln('\x1b[0;36mConsole: /dev/ttyS0 Serial Port • Full Busybox Coreutils\x1b[0m\r\n');
          vmConfig = {
            ...vmConfig,
            bzimage: { url: '/v86/buildroot-bzimage.bin' },
            cmdline: 'console=ttyS0 root=/dev/ram0 rw quiet',
          };
        } else if (engine === 'cotton-os') {
          term.writeln('\x1b[1;32m==> Booting CottonOS (Real Rust x86_64 Kernel by Aryan Rao)...\x1b[0m');
          term.writeln('\x1b[0;36mKernel: Multiboot2 _start64 • CottonFS • smoltcp TCP/IP • Framebuffer GUI\x1b[0m\r\n');
          vmConfig = {
            ...vmConfig,
            cdrom: { url: '/v86/cottonos.iso' },
            screen_container: screenRef.current,
          };
        }

        const emulator = new V86(vmConfig);
        v86EmulatorRef.current = emulator;

        // Pipe raw serial character output from guest Linux kernel straight to xterm.js
        emulator.add_listener('serial0-output-char', (char: string) => {
          term.write(char);
        });

        // Pipe all user input and outside clipboard straight into the guest serial device
        term.onData((data: string) => {
          try {
            emulator.serial0_send(data);
          } catch (_) {}
        });

        emulator.add_listener('emulator-ready', () => {
          setVmStatus('running');
          setStatusMessage(
            engine === 'arch-vm'
              ? 'Arch Linux VM Active (pacman & network ready)'
              : engine === 'linux-vm'
              ? 'Linux Kernel VM Active (/dev/ttyS0)'
              : 'CottonOS Rust Kernel Active'
          );
        });

      } catch (err: any) {
        setVmStatus('error');
        setStatusMessage(`VM Error: ${err.message}`);
        term.writeln(`\r\n\x1b[1;31mError starting virtual machine: ${err.message}\x1b[0m`);
      }
    };

    startTerminal();

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch (_) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isCancelled = true;
      window.removeEventListener('resize', handleResize);
      if (v86EmulatorRef.current) {
        try {
          v86EmulatorRef.current.destroy();
        } catch (_) {}
        v86EmulatorRef.current = null;
      }
      if (ptySocketRef.current) {
        try {
          ptySocketRef.current.close();
        } catch (_) {}
        ptySocketRef.current = null;
      }
      if (term) {
        try {
          term.dispose();
        } catch (_) {}
      }
    };
  }, [engine]);

  // Outside Native Clipboard Paste Handler (Cmd+V / Button)
  const handlePasteOutside = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      if (engine === 'native-pty' && ptySocketRef.current?.readyState === WebSocket.OPEN) {
        ptySocketRef.current.send(text);
      } else if (v86EmulatorRef.current) {
        v86EmulatorRef.current.serial0_send(text);
      }

      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);
    } catch (_) {}
  };

  // Reboot active engine
  const handleRestart = () => {
    if (engine === 'native-pty') {
      if (ptySocketRef.current) {
        ptySocketRef.current.close();
      }
      setEngine('native-pty');
    } else if (v86EmulatorRef.current) {
      try {
        v86EmulatorRef.current.restart();
      } catch (_) {}
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0d14] text-slate-100 font-sans select-none overflow-hidden">
      {/* Top Header / Real Engine Selector */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
            <TerminalIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-sm tracking-wide">TheySynced Real Linux Terminal</span>
              <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-mono border border-emerald-500/30">
                <span className={`w-1.5 h-1.5 rounded-full ${vmStatus === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span>{vmStatus === 'running' ? 'REAL OS RUNNING' : vmStatus.toUpperCase()}</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {statusMessage}
            </p>
          </div>
        </div>

        {/* Real OS Engines */}
        <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setEngine('arch-vm')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center space-x-1.5 ${
              engine === 'arch-vm'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Real Arch Linux (WASM)</span>
          </button>

          <button
            onClick={() => setEngine('linux-vm')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center space-x-1.5 ${
              engine === 'linux-vm'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Linux Kernel 6.x</span>
          </button>

          <button
            onClick={() => setEngine('cotton-os')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center space-x-1.5 ${
              engine === 'cotton-os'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>CottonOS (Rust x86_64)</span>
          </button>

          <button
            onClick={() => setEngine('native-pty')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center space-x-1.5 ${
              engine === 'native-pty'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Native Host PTY</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {engine === 'cotton-os' && (
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-white/10 text-xs mr-2">
              <button
                onClick={() => setCottonDisplayMode('console')}
                className={`px-2 py-1 rounded text-[11px] ${
                  cottonDisplayMode === 'console' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'
                }`}
              >
                Serial Console
              </button>
              <button
                onClick={() => setCottonDisplayMode('gui')}
                className={`px-2 py-1 rounded text-[11px] ${
                  cottonDisplayMode === 'gui' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'
                }`}
              >
                Desktop GUI
              </button>
            </div>
          )}

          <button
            onClick={handlePasteOutside}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 text-xs font-mono transition"
            title="Paste external clipboard (Cmd+V)"
          >
            {copiedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{copiedSuccess ? 'Pasted!' : 'Paste'}</span>
          </button>

          <button
            onClick={handleRestart}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-white/10 transition"
            title="Reboot virtual machine / reconnect PTY"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Terminal Viewport */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex flex-col bg-[#0a0d14]">
        {/* Graphical Screen for CottonOS Desktop Window Manager */}
        {engine === 'cotton-os' && cottonDisplayMode === 'gui' && (
          <div 
            ref={screenRef} 
            className="flex-1 w-full h-full bg-black flex items-center justify-center overflow-auto"
            tabIndex={0}
          >
            <div style={{ whiteSpace: 'pre', font: '14px monospace', lineHeight: '14px' }} />
            <canvas style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }} />
          </div>
        )}

        {/* xterm.js Terminal Viewport */}
        <div 
          ref={terminalRef} 
          className={`flex-1 w-full h-full bg-[#0a0d14] p-3 overflow-hidden select-text ${
            engine === 'cotton-os' && cottonDisplayMode === 'gui' ? 'hidden' : 'block'
          }`}
          style={{ minHeight: '300px' }}
        />
      </div>

      {/* Terminal Footer Bar */}
      <div className="bg-[#12161f] border-t border-white/10 px-4 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-sans shrink-0 gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5" />
            Execution: <strong className="text-white ml-1 font-mono">
              {engine === 'arch-vm'
                ? 'Arch Linux x86 (v86 WASM)'
                : engine === 'linux-vm'
                ? 'Linux Kernel 6.x (Buildroot bzImage)'
                : engine === 'cotton-os'
                ? 'CottonOS Kernel (Rust x86_64)'
                : 'Native Host Shell (PTY)'}
            </strong>
          </span>
          <span className="hidden sm:inline text-slate-400">
            &bull; Networking: <strong className="text-cyan-300 font-mono">Virtio Ethernet (Internet Relay Active)</strong>
          </span>
        </div>

        <div className="flex items-center space-x-3 text-[10px] font-mono text-slate-400">
          <span className="text-emerald-400">● 0% JavaScript Simulation</span>
          <span>&bull; Full Clipboard IO (Cmd+C / Cmd+V)</span>
        </div>
      </div>
    </div>
  );
};
