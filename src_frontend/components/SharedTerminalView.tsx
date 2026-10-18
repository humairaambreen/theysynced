'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, RotateCcw, FolderGit2, Download, 
  Check, Copy, Sparkles, ExternalLink, HardDrive, Cpu, Radio, ShieldCheck
} from 'lucide-react';
import { buildCompanyLinuxFilesystem } from '../lib/linuxFilesystem';

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
  // Engine Mode: 'arch' (Arch Linux VM via v86), 'rust-pty' (Rust portable-pty WebSocket), or 'minimal' (Buildroot)
  const [engineMode, setEngineMode] = useState<'arch' | 'rust-pty' | 'minimal'>('arch');
  const [vmKey, setVmKey] = useState<number>(0);
  const [showMountModal, setShowMountModal] = useState<boolean>(false);
  const [copiedMount, setCopiedMount] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  // Rust Native PTY WebSocket State
  const [rustLogs, setRustLogs] = useState<string>('🦀 Connecting to TheySynced Rust Axum PTY Engine...\n');
  const [rustInput, setRustInput] = useState<string>('');
  const [isRustConnected, setIsRustConnected] = useState<boolean>(false);
  const rustWsRef = useRef<WebSocket | null>(null);
  const rustTerminalEndRef = useRef<HTMLDivElement>(null);
  const rustInputRef = useRef<HTMLInputElement>(null);

  // Connect to Rust Axum PTY WebSocket when in 'rust-pty' mode
  useEffect(() => {
    if (engineMode !== 'rust-pty') {
      if (rustWsRef.current) {
        rustWsRef.current.close();
        rustWsRef.current = null;
      }
      return;
    }

    const host = window.location.hostname || 'localhost';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Port 8000 for local dev or same port in proxy
    const wsUrl = `${proto}//${host}:8000/ws/terminal`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setRustLogs((prev) => prev + '❌ Could not connect to Rust PTY server at ' + wsUrl + '\n');
      return;
    }

    ws.binaryType = 'arraybuffer';
    rustWsRef.current = ws;

    ws.onopen = () => {
      setIsRustConnected(true);
      setRustLogs((prev) => prev + '⚡ Connected to Rust native PTY! Spawning shell session...\n');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        setRustLogs((prev) => prev + event.data);
      } else if (event.data instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(event.data);
        setRustLogs((prev) => prev + text);
      }
    };

    ws.onerror = () => {
      setIsRustConnected(false);
      setRustLogs((prev) => prev + '⚠️ Rust PTY WebSocket connection failed. Ensure `cargo run` is running on port 8000.\n');
    };

    ws.onclose = () => {
      setIsRustConnected(false);
      setRustLogs((prev) => prev + '\n[Rust PTY Session Disconnected]\n');
    };

    return () => {
      ws.close();
      rustWsRef.current = null;
    };
  }, [engineMode]);

  useEffect(() => {
    if (engineMode === 'rust-pty') {
      rustTerminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [rustLogs, engineMode]);

  const handleRustInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (rustWsRef.current && rustWsRef.current.readyState === WebSocket.OPEN) {
        rustWsRef.current.send(rustInput + '\n');
      }
      setRustInput('');
    } else if (e.ctrlKey && e.key === 'c') {
      if (rustWsRef.current && rustWsRef.current.readyState === WebSocket.OPEN) {
        rustWsRef.current.send('\x03');
      }
      setRustInput('');
    }
  };

  // Build unified Linux filesystem entries for company assets
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Generate self-contained Arch Linux bash script that mounts all company files into /workspace
  const mountScript = useMemo(() => {
    let sh = `#!/bin/bash
# ==============================================================================
# TheySynced Arch Linux VM - Direct Workspace Auto-Mount
# Organization: ${company.name} (${company.id})
# User: ${user.username}
# ==============================================================================
echo "⚡ Mounting TheySynced Workspace in Arch Linux..."
mkdir -p /workspace/chats /workspace/spreadsheets /workspace/drawings /workspace/docs /workspace/tasks /workspace/files /workspace/export

`;

    // 1. Tasks
    const taskAsset = assets.find((a) => a.id === `tasks_${company.id}` || a.name === 'tasks.json');
    if (taskAsset && taskAsset.content) {
      const cleanContent = taskAsset.content.replace(/'/g, "'\\''");
      sh += `cat << 'EOF' > /workspace/tasks/tasks.json\n${cleanContent}\nEOF\n`;
    }

    // 2. Spreadsheets, Whiteboards, Docs, and Files
    for (const a of assets) {
      if (a.content && a.name && a.name !== 'tasks.json') {
        let folder = '/workspace/files';
        if (a.asset_type === 'spreadsheet' || a.name.endsWith('.sheet.json') || a.name.endsWith('.csv')) {
          folder = '/workspace/spreadsheets';
        } else if (a.asset_type === 'whiteboard' || a.name.endsWith('.excalidraw.json')) {
          folder = '/workspace/drawings';
        } else if (a.asset_type === 'doc' || a.name.endsWith('.doc.json') || a.name.endsWith('.md')) {
          folder = '/workspace/docs';
        } else if (a.folder_path && a.folder_path.startsWith('/workspace')) {
          folder = a.folder_path;
        }

        const safeName = a.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const cleanContent = a.content.replace(/'/g, "'\\''");
        sh += `mkdir -p "${folder}"\ncat << 'EOF' > "${folder}/${safeName}"\n${cleanContent}\nEOF\n`;
      }
    }

    // 3. Chat History
    const generalMsgs = chatMessages.slice(-50);
    if (generalMsgs.length > 0) {
      const chatLog = generalMsgs
        .map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.username}: ${m.message}`)
        .join('\n')
        .replace(/'/g, "'\\''");
      sh += `cat << 'EOF' > /workspace/chats/general_chat.txt\n${chatLog}\nEOF\n`;
    }

    sh += `
echo "✅ /workspace successfully mounted in Arch Linux!"
echo "Files ready in /workspace:"
ls -la /workspace
`;
    return sh;
  }, [company.name, company.id, user.username, assets, chatMessages]);

  const curlCommand = `curl -sSL "https://app.theysynced.workers.dev/api/workspace/bootstrap.sh?company_id=${company.id}" | bash`;

  const handleCopyMountScript = () => {
    navigator.clipboard.writeText(mountScript.trim());
    setCopiedMount(true);
    setTimeout(() => setCopiedMount(false), 2500);
  };

  const handleCopyCurlCommand = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2500);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0d14] text-slate-100 font-mono text-xs select-text overflow-hidden">
      
      {/* Top Header: Distro & Engine Switcher Bar */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2 flex flex-wrap items-center justify-between shrink-0 select-none z-10 gap-2">
        <div className="flex items-center space-x-3">
          {/* Window Controls */}
          <div className="flex items-center space-x-1.5">
            <button 
              onClick={() => setVmKey((k) => k + 1)} 
              className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 transition" 
              title="Reboot Linux VM" 
            />
            <button 
              onClick={() => setVmKey((k) => k + 1)} 
              className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 transition" 
              title="Reset Virtual Display" 
            />
            <button 
              className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 transition" 
              title="Linux Virtual Machine Active" 
            />
          </div>

          {/* Engine / Distro Switcher Pills */}
          <div className="flex items-center bg-slate-900/90 p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => setEngineMode('arch')}
              className={`px-3 py-1 rounded-md text-xs font-bold flex items-center space-x-1.5 transition ${
                engineMode === 'arch'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🏹 Arch Linux (Wasm)</span>
            </button>

            <button
              onClick={() => setEngineMode('rust-pty')}
              className={`px-3 py-1 rounded-md text-xs font-bold flex items-center space-x-1.5 transition ${
                engineMode === 'rust-pty'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🦀 Rust PTY (Realtime)</span>
            </button>

            <button
              onClick={() => setEngineMode('minimal')}
              className={`px-3 py-1 rounded-md text-xs font-bold flex items-center space-x-1.5 transition ${
                engineMode === 'minimal'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>⚡ Minimal Linux (4.9MB)</span>
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-sans">
          {/* Mount /workspace Button */}
          <button
            onClick={() => setShowMountModal(!showMountModal)}
            className="flex items-center space-x-1.5 px-3 py-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg shadow-sm font-bold transition"
            title="Mount company files into /workspace inside the Linux VM"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
            <span>Mount /workspace</span>
          </button>

          {/* Nautilus GUI Shortcut */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('assets', '/workspace')}
              className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 transition"
              title="Open /workspace in Nautilus File System GUI"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Nautilus GUI</span>
            </button>
          )}

          {/* Reboot VM */}
          <button
            onClick={() => setVmKey((k) => k + 1)}
            className="flex items-center space-x-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-white/10 transition"
            title="Reboot Linux Virtual Machine"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reboot</span>
          </button>
        </div>
      </div>

      {/* Mount Workspace Modal / Popover */}
      {showMountModal && (
        <div className="bg-[#161b26] border-b border-cyan-500/30 p-4 shrink-0 font-sans text-xs select-text shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="bg-cyan-500/20 text-cyan-400 font-bold px-2 py-0.5 rounded text-[11px]">
                  Arch Linux Workspace Mount
                </span>
                <span className="text-white font-bold">{company.name} Assets Ready</span>
              </div>
              <p className="text-slate-300 text-[12px] leading-relaxed">
                Click <strong>&quot;Copy Mount Script&quot;</strong>, then simply paste into the terminal below (<kbd className="bg-slate-800 px-1 rounded text-white font-mono">Cmd+V</kbd> or <kbd className="bg-slate-800 px-1 rounded text-white font-mono">Ctrl+V</kbd>) and press <kbd className="bg-slate-800 px-1 rounded text-white font-mono">Enter</kbd> to populate <code className="text-cyan-400 font-mono">/workspace</code> with all company files!
              </p>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleCopyMountScript}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold shadow transition"
              >
                {copiedMount ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
                <span>{copiedMount ? 'Script Copied!' : 'Copy Mount Script'}</span>
              </button>

              <button
                onClick={handleCopyCurlCommand}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 font-mono transition"
                title="Copy curl one-liner bootstrap command"
              >
                {copiedCurl ? <Check className="w-4 h-4 text-emerald-400" /> : <Download className="w-4 h-4 text-indigo-400" />}
                <span>{copiedCurl ? 'Copied' : 'curl One-Liner'}</span>
              </button>

              <button
                onClick={() => setShowMountModal(false)}
                className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Terminal Viewport */}
      {engineMode === 'rust-pty' ? (
        /* Real-Time Rust Axum PTY Terminal */
        <div 
          onClick={() => rustInputRef.current?.focus()} 
          className="relative flex-1 w-full h-full bg-[#05080f] p-4 font-mono text-xs overflow-y-auto select-text cursor-text flex flex-col"
        >
          <div className="flex items-center space-x-2 mb-2 pb-1 border-b border-white/5 text-slate-400 text-[11px]">
            <Radio className={`w-3.5 h-3.5 ${isRustConnected ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
            <span>Engine: <strong>TheySynced Rust Axum PTY (portable-pty)</strong></span>
            <span>&bull; Status: <strong className={isRustConnected ? 'text-emerald-300' : 'text-amber-300'}>{isRustConnected ? 'Active PTY Shell' : 'Connecting (Port 8000)...'}</strong></span>
          </div>

          <pre className="flex-1 whitespace-pre-wrap break-words text-slate-200 leading-relaxed font-mono">
            {rustLogs}
          </pre>

          <div className="flex items-center space-x-2 pt-2 border-t border-white/10">
            <span className="text-amber-400 font-bold shrink-0">rust-pty&gt;</span>
            <input
              ref={rustInputRef}
              type="text"
              value={rustInput}
              onChange={(e) => setRustInput(e.target.value)}
              onKeyDown={handleRustInputKeyDown}
              className="flex-1 bg-transparent text-white font-mono outline-none caret-amber-400 text-xs"
              autoFocus
              placeholder="Type command and press Enter (or Ctrl+C to interrupt)..."
            />
          </div>

          <div ref={rustTerminalEndRef} />
        </div>
      ) : (
        /* Real Arch Linux / Buildroot VM via v86 WebAssembly */
        <div className="relative flex-1 w-full h-full overflow-hidden bg-black select-text">
          <iframe
            key={`${engineMode}-${vmKey}`}
            src={
              engineMode === 'arch'
                ? 'https://copy.sh/v86/?profile=archlinux'
                : 'https://copy.sh/v86/?profile=buildroot'
            }
            className="w-full h-full border-0 bg-black"
            allow="clipboard-read; clipboard-write; fullscreen"
            title={`${engineMode === 'arch' ? 'Arch Linux' : 'Minimal Linux'} Virtual Machine`}
          />
        </div>
      )}

      {/* Terminal Footer Info Bar */}
      <div className="bg-[#12161f] border-t border-white/10 px-4 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-sans shrink-0 gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-cyan-400 mr-1.5 animate-pulse" />
            Active: <strong className="text-white ml-1 font-mono">{engineMode === 'arch' ? 'Arch Linux VM (x86 Wasm)' : engineMode === 'rust-pty' ? 'Rust Axum PTY (portable-pty)' : 'Minimal Buildroot Linux'}</strong>
          </span>
          <span className="hidden sm:inline text-slate-400">
            &bull; Distro: <strong className="text-cyan-300 font-mono">Arch / Rolling Minimal</strong>
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400 overflow-x-auto py-0.5">
          <span className="text-slate-500 font-sans hidden md:inline">Arch Commands:</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-cyan-300">pacman -Syu</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-slate-300">ls -la /workspace</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-slate-300">cat /workspace/tasks/tasks.json</span>
        </div>
      </div>

    </div>
  );
};
