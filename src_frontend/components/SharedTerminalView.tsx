'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { Terminal as TerminalIcon, RotateCcw } from 'lucide-react';
import { VfsClient, VfsEvent } from '../lib/linuxFilesystem';
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
  token?: string;
}

interface TerminalConfig {
  mode: 'mode_a' | 'mode_b';
  container_runtime_available: boolean;
  active_mode: 'mode_a' | 'mode_b';
  kernel_url: string;
  wasm_url: string;
  bios_url: string;
  vga_bios_url: string;
  arch_snapshot_usable: boolean;
  explanation: string;
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

function ensureFs9pDir(fs9p: any, path: string): number {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  let currentId = 0;
  for (const part of parts) {
    let childId = fs9p.Search(currentId, part);
    if (childId === -1) {
      childId = fs9p.CreateDirectory(part, currentId);
    }
    currentId = childId;
  }
  return currentId;
}

async function writeFs9pFile(fs9p: any, filePath: string, content: string | Uint8Array) {
  const cleanPath = filePath.replace(/^\/+/, '');
  const lastSlash = cleanPath.lastIndexOf('/');
  let parentId = 0;
  let filename = cleanPath;
  if (lastSlash !== -1) {
    const dir = cleanPath.substring(0, lastSlash);
    filename = cleanPath.substring(lastSlash + 1);
    parentId = ensureFs9pDir(fs9p, dir);
  }
  const existing = fs9p.Search(parentId, filename);
  if (existing !== -1) {
    fs9p.Unlink(parentId, filename);
  }
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  await fs9p.CreateBinaryFile(filename, parentId, bytes);
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
  token,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  const [engineStatus, setEngineStatus] = useState<string>('Initializing Terminal...');
  const [isLive, setIsLive] = useState<boolean>(false);

  const ptyWsRef = useRef<WebSocket | null>(null);
  const v86InstanceRef = useRef<any>(null);
  const activeModeRef = useRef<'pty' | 'wasm' | 'none'>('none');
  const vfsClientRef = useRef<VfsClient | null>(null);

  const sessionToken = useMemo(() => {
    return token || (typeof window !== 'undefined' ? localStorage.getItem('theysynced_token') || '' : '');
  }, [token]);

  const hostname = useMemo(() => {
    const slug = (company.name || 'theysynced')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'theysynced';
    return `theysynced-${slug}`;
  }, [company.name]);

  useEffect(() => {
    if (sessionToken && company.id) {
      vfsClientRef.current = new VfsClient(sessionToken, company.id);
    }
  }, [sessionToken, company.id]);

  // Boot Real WebAssembly Linux Kernel (Linux 5.6.15 Buildroot)
  const bootWasmKernel = async (term: any) => {
    try {
      setEngineStatus('Booting Real Linux Kernel in WASM (v5.6.15)...');
      term.writeln('\x1b[1;36mInitializing Real Linux x86 WebAssembly Emulator (v86)...\x1b[0m');
      term.writeln('Kernel: \x1b[33mLinux 5.6.15-buildroot\x1b[0m | Console: \x1b[32m/dev/ttyS0\x1b[0m');
      term.writeln('Userland: \x1b[32mBusyBox v1.31.1\x1b[0m | Mode: \x1b[36mBrowser Sandbox (Mode A)\x1b[0m');
      term.writeln('Mounting company VFS files with verified session permissions via virtio-9p...\r\n');

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

      // Fetch verified VFS file projection from server
      let exportedFiles: Array<{ path: string; kind: string; mode: number; content: string }> = [];
      try {
        const resp = await fetch(`/api/vfs/export-tree?token=${encodeURIComponent(sessionToken)}&company_id=${encodeURIComponent(company.id)}`);
        const json = await resp.json();
        if (json.success && Array.isArray(json.files)) {
          exportedFiles = json.files;
        }
      } catch (err: any) {
        term.writeln(`\x1b[33mWarning: Failed to fetch VFS files: ${err.message}. Initializing empty workspace.\x1b[0m\r\n`);
      }

      const emulator = new V86Class({
        wasm_path: '/v86/v86.wasm',
        memory_size: 64 * 1024 * 1024,
        bios: { url: '/v86/seabios.bin' },
        vga_bios: { url: '/v86/vgabios.bin' },
        bzimage: { url: '/v86/buildroot-bzimage.bin' },
        filesystem: {},
        cmdline: 'console=ttyS0 root=/dev/ram0 rw quiet',
        autostart: true,
      });

      v86InstanceRef.current = emulator;
      activeModeRef.current = 'wasm';
      setIsLive(true);
      setEngineStatus('Real Linux Kernel 5.6.15 (WASM v86)');

      // Stream serial output bytes directly from Linux kernel to xterm.js
      emulator.add_listener('serial0-output-byte', (byte: number) => {
        term.write(String.fromCharCode(byte));
      });

      // Populate fs9p tree before mounting in guest
      if (emulator.fs9p) {
        ensureFs9pDir(emulator.fs9p, 'workspace');
        for (const file of exportedFiles) {
          const relPath = file.path.replace(/^\/+/, '');
          await writeFs9pFile(emulator.fs9p, `workspace/${relPath}`, file.content);
        }

        // Hook fs9p write notifications to sync back to VFS server
        const originalNotify = emulator.fs9p.NotifyListeners ? emulator.fs9p.NotifyListeners.bind(emulator.fs9p) : null;
        emulator.fs9p.NotifyListeners = async (inodeId: number, op: string, details?: any) => {
          if (originalNotify) originalNotify(inodeId, op, details);
          if ((op === 'write' || op === 'newfile') && vfsClientRef.current) {
            try {
              const fullPath = emulator.fs9p.GetFullPath(inodeId);
              if (fullPath && fullPath.startsWith('/workspace/')) {
                const inode = emulator.fs9p.GetInode(inodeId);
                if (inode && !emulator.fs9p.IsDirectory(inodeId)) {
                  const data = await emulator.fs9p.Read(inodeId, 0, inode.size);
                  const content = new TextDecoder().decode(data);
                  const vfsPath = fullPath.replace(/^\/workspace/, '');
                  await vfsClientRef.current.write(vfsPath, content);
                }
              }
            } catch (_) {}
          }
        };
      }

      // Initialize guest shell once kernel finishes uncompressing
      let initialized = false;
      const initGuestWorkspace = () => {
        if (initialized || !v86InstanceRef.current) return;
        initialized = true;

        const cleanUser = (user?.username || 'user').replace(/[^a-zA-Z0-9_-]/g, '');
        const cmds: string[] = [
          'mkdir -p /workspace',
          'mount -t 9p -o trans=virtio host9p /workspace 2>/dev/null || mount -t 9p host9p /workspace 2>/dev/null',
          'cd /workspace',
          `export PS1='[${cleanUser}@${hostname} \\W]\\$ '`,
          'clear',
          'echo "======================================================================="',
          'echo "  TheySynced Work OS - Browser WebAssembly Linux Kernel (v86)"',
          'echo "  Kernel: Linux 5.6.15-buildroot (i386) | Console: /dev/ttyS0"',
          'echo "  Environment: Minimal embedded Linux with BusyBox & wget."',
          'echo "  Package Manager Note: Minimal BusyBox Linux. For pacman/apt, use Mode B."',
          `echo "  Organization: ${company.name} | Mounted at /workspace via virtio-9p"`,
          'echo "======================================================================="',
          'ls -la',
        ];

        v86InstanceRef.current.serial0_send(cmds.join('\n') + '\n');
      };

      setTimeout(initGuestWorkspace, 3400);

      term.writeln('\x1b[32m✓ Real Linux Kernel running directly in WebAssembly.\x1b[0m\r\n');
    } catch (err: any) {
      term.writeln(`\r\n\x1b[31mFailed to boot WASM Linux kernel: ${err.message}\x1b[0m\r\n`);
      setEngineStatus('WASM Boot Error');
    }
  };

  // Connect to Real Container PTY WebSocket (Mode B)
  const tryConnectPty = (term: any): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        const loc = window.location;
        let wsHost = loc.host;
        if (loc.port === '3000') {
          wsHost = `${loc.hostname}:8080`;
        }
        const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        const cols = term?.cols || 100;
        const rows = term?.rows || 30;

        const wsUrl = `${wsProto}//${wsHost}/ws/terminal?token=${encodeURIComponent(sessionToken)}&company_id=${encodeURIComponent(company.id)}&cols=${cols}&rows=${rows}`;

        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            try { ws.close(); } catch (_) {}
            resolved = true;
            resolve(false);
          }
        }, 2500);

        ws.onopen = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          ptyWsRef.current = ws;
          activeModeRef.current = 'pty';
          setIsLive(true);
          setEngineStatus('Real Linux Container PTY (Native Mode B)');
          term.writeln('\x1b[1;32m✓ Connected to Native Linux Container Session (Mode B)\x1b[0m');
          term.writeln(`Host: \x1b[1;36m${hostname}\x1b[0m | User: \x1b[1;33m${user.username}\x1b[0m | Sandboxed Container\r\n`);
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
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        };

        ws.onclose = () => {
          if (activeModeRef.current === 'pty') {
            term.writeln('\r\n\x1b[33m[Mode B container session closed. Switching to Real WebAssembly Linux Kernel...]\x1b[0m\r\n');
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
    let vfsUnsub: (() => void) | null = null;

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

      // Forward keyboard input directly to the active engine
      term.onData((data: string) => {
        if (activeModeRef.current === 'pty' && ptyWsRef.current?.readyState === WebSocket.OPEN) {
          ptyWsRef.current.send(data);
        } else if (activeModeRef.current === 'wasm' && v86InstanceRef.current) {
          v86InstanceRef.current.serial0_send(data);
        }
      });

      // Check server terminal configuration
      let config: TerminalConfig | null = null;
      try {
        const res = await fetch('/api/terminal/config');
        if (res.ok) {
          config = await res.json();
        }
      } catch (_) {}

      // If Mode B is active on server, try container WebSocket
      if (config?.active_mode === 'mode_b') {
        const ptyConnected = await tryConnectPty(term);
        if (!ptyConnected) {
          term.writeln('\x1b[33m[Mode B container runtime unavailable. Falling back to Mode A (v86 WebAssembly Linux)...]\x1b[0m\r\n');
          await bootWasmKernel(term);
        }
      } else {
        // Mode A (default)
        await bootWasmKernel(term);
      }

      // Connect to VFS WebSocket for real-time live synchronization
      if (vfsClientRef.current) {
        vfsUnsub = vfsClientRef.current.connectWs(async (event: VfsEvent) => {
          if (activeModeRef.current === 'wasm' && v86InstanceRef.current?.fs9p && vfsClientRef.current) {
            if (event.op === 'write' || event.op === 'create' || event.op === 'message') {
              try {
                if (event.path) {
                  const content = await vfsClientRef.current.read(event.path);
                  const relPath = event.path.replace(/^\/+/, '');
                  await writeFs9pFile(v86InstanceRef.current.fs9p, `workspace/${relPath}`, content);
                }
              } catch (_) {}
            }
          }
        });
      }
    };

    init();

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch (_) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (vfsUnsub) vfsUnsub();
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
  }, [sessionToken, company.id]);

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
