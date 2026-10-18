'use client';

import React, { useState, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, RotateCcw, FolderGit2, Download, 
  Check, Copy, Sparkles, ExternalLink, HardDrive, Layers, HelpCircle
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
  const [vmKey, setVmKey] = useState<number>(0);
  const [showMountModal, setShowMountModal] = useState<boolean>(false);
  const [copiedMount, setCopiedMount] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  const hostname = useMemo(() => {
    const slug = (company.name || 'theysynced')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || company.id.slice(0, 8);
    return `theysynced-${slug}`;
  }, [company.name, company.id]);

  // Build unified Linux filesystem entries for company assets
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Generate self-contained bash script that mounts all company files into /workspace
  const mountScript = useMemo(() => {
    let sh = `#!/bin/bash
# ==============================================================================
# TheySynced Real Linux VM - Direct Workspace Auto-Mount
# Organization: ${company.name} (${company.id})
# Generated for: ${user.username}
# ==============================================================================
echo "⚡ Initializing /workspace for ${company.name}..."
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
echo "✅ /workspace successfully mounted with real company assets!"
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
      
      {/* Top Header: Real Debian 12 Linux System Bar */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2 flex items-center justify-between shrink-0 select-none z-10">
        <div className="flex items-center space-x-3">
          {/* macOS Window Controls */}
          <div className="flex items-center space-x-1.5">
            <button 
              onClick={() => setVmKey((k) => k + 1)} 
              className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 transition" 
              title="Reboot Real Linux VM" 
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

          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-white tracking-tight">Debian 12 GNU/Linux VM (x86_64)</span>
            <span className="hidden md:inline bg-indigo-950/80 text-indigo-300 text-[11px] px-2 py-0.5 rounded border border-indigo-500/20 font-sans">
              Real apt-get &bull; bash &bull; gcc &bull; python
            </span>
            <span className="hidden lg:inline bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded border border-white/10 font-sans">
              Org: {company.name}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-sans">
          {/* Mount /workspace Button */}
          <button
            onClick={() => setShowMountModal(!showMountModal)}
            className="flex items-center space-x-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg shadow-sm font-bold transition"
            title="Mount company files into /workspace inside the real Linux VM"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
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
        <div className="bg-[#161b26] border-b border-indigo-500/30 p-4 shrink-0 font-sans text-xs select-text shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-[11px]">
                  Real Linux Workspace Mount
                </span>
                <span className="text-white font-bold">{company.name} Assets Ready</span>
              </div>
              <p className="text-slate-300 text-[12px] leading-relaxed">
                Click <strong>&quot;Copy Mount Script&quot;</strong>, then simply paste into the terminal below (<kbd className="bg-slate-800 px-1 rounded text-white font-mono">Cmd+V</kbd> or <kbd className="bg-slate-800 px-1 rounded text-white font-mono">Ctrl+V</kbd>) and press <kbd className="bg-slate-800 px-1 rounded text-white font-mono">Enter</kbd> to populate <code className="text-emerald-400 font-mono">/workspace</code> with all company files!
              </p>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleCopyMountScript}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow transition"
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

      {/* Main Terminal Viewport: Real Debian 12 WebAssembly VM */}
      {/* The 56px left WebVM sidebar is cleanly clipped off so NO Discord, GitHub, or LeaningTech icons appear */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-black select-text">
        <iframe
          key={vmKey}
          src="https://webvm.io"
          className="absolute top-0 border-0 bg-black"
          style={{
            left: '-56px',
            width: 'calc(100% + 56px)',
            height: '100%',
          }}
          allow="clipboard-read; clipboard-write; fullscreen; cross-origin-isolated"
          title="Real Debian 12 Linux Virtual Machine (WebVM)"
        />
      </div>

      {/* Terminal Footer Info Bar */}
      <div className="bg-[#12161f] border-t border-white/10 px-4 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-sans shrink-0 gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5" />
            Distro: <strong className="text-white ml-1 font-mono">Debian 12 Bookworm (x86_64)</strong>
          </span>
          <span className="hidden sm:inline text-slate-400">
            &bull; Kernel: <strong className="text-slate-300 font-mono">Real Linux VM &bull; Zero Hardcoded Commands</strong>
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400 overflow-x-auto py-0.5">
          <span className="text-slate-500 font-sans hidden md:inline">Real commands:</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-slate-300">apt-get update</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-slate-300">apt-get install -y python3 gcc git</span>
          <span className="px-1.5 py-0.5 bg-slate-800 rounded border border-white/5 text-slate-300">ls -la /workspace</span>
        </div>
      </div>

    </div>
  );
};
