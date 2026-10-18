'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, Trash2, FolderGit2, Save, X, 
  Copy, Check, Sparkles, CornerDownLeft, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { buildCompanyLinuxFilesystem, LinuxFileEntry } from '../lib/linuxFilesystem';
import { LinuxVirtualKernel, ShellExecResult } from '../lib/linuxVirtualKernel';

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

interface TerminalLog {
  id: string;
  user: string;
  type: 'command' | 'output' | 'error' | 'system';
  text: string;
  timestamp: string;
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
  const companySlug = useMemo(() => {
    return (company.name || 'org')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || company.id.slice(0, 8);
  }, [company.name, company.id]);

  const hostname = `theysynced-${companySlug}`;

  const isAdmin = useMemo(() => {
    if (company.owner_id === user.id) return true;
    return (company.members || []).some(
      (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
    );
  }, [company.owner_id, company.members, user.id]);

  // Working Directory & Prompt State
  const [cwd, setCwd] = useState<string>(initialPath || '/workspace');
  const [inputVal, setInputVal] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Privileges State: normal user ($) vs root superuser (#)
  const [isRoot, setIsRoot] = useState<boolean>(false);

  // Terminal Display Controls
  const [fontSize, setFontSize] = useState<'text-xs' | 'text-sm' | 'text-base'>('text-xs');
  const [copiedBuffer, setCopiedBuffer] = useState<boolean>(false);

  // Installed Packages State (Shared across company via D1 asset)
  const [installedPackages, setInstalledPackages] = useState<string[]>(() => {
    const pkgAsset = assets.find((a) => a.id === `linux_packages_${company.id}`);
    if (pkgAsset && pkgAsset.content) {
      try {
        const parsed = JSON.parse(pkgAsset.content);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
    }
    // Default initial packages: Clean Linux system without pre-installed bloat
    return ['base-files', 'coreutils', 'bash'];
  });

  // Interactive REPL States
  const [isPythonRepl, setIsPythonRepl] = useState<boolean>(false);
  const [isNodeRepl, setIsNodeRepl] = useState<boolean>(false);
  const [isPyodideLoading, setIsPyodideLoading] = useState<boolean>(false);

  // In-Terminal Text Editor (nano) State
  const [nanoActive, setNanoActive] = useState<boolean>(false);
  const [nanoFileName, setNanoFileName] = useState<string>('');
  const [nanoContent, setNanoContent] = useState<string>('');
  const [nanoModified, setNanoModified] = useState<boolean>(false);

  const pyodideRef = useRef<any>(null);
  const kernelRef = useRef<LinuxVirtualKernel | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nanoTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Build unified Linux filesystem entries from company state
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Initialize or re-sync Virtual Linux Kernel
  useEffect(() => {
    const kernel = new LinuxVirtualKernel(company.name, company.id, hostname, installedPackages);
    kernel.mountCompanyFiles(linuxEntries, user.username);
    kernelRef.current = kernel;
  }, [company.name, company.id, hostname, linuxEntries, user.username, installedPackages]);

  // Sync installed packages if updated in assets
  useEffect(() => {
    const pkgAsset = assets.find((a) => a.id === `linux_packages_${company.id}`);
    if (pkgAsset && pkgAsset.content) {
      try {
        const parsed = JSON.parse(pkgAsset.content);
        if (Array.isArray(parsed)) {
          setInstalledPackages(parsed);
          if (kernelRef.current) kernelRef.current.setInstalledPackages(parsed);
        }
      } catch (_) {}
    }
  }, [assets, company.id]);

  // Persist installed packages to company shared asset
  const saveInstalledPackages = async (pkgs: string[]) => {
    setInstalledPackages(pkgs);
    if (kernelRef.current) kernelRef.current.setInstalledPackages(pkgs);
    await onSaveAsset({
      id: `linux_packages_${company.id}`,
      company_id: company.id,
      asset_type: 'file',
      name: 'installed_packages.json',
      folder_path: '/var/lib/dpkg',
      content: JSON.stringify(pkgs, null, 2),
      size: JSON.stringify(pkgs).length,
      created_by: 'system',
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });
  };

  // Initial Welcome MOTD
  const initialLogs: TerminalLog[] = useMemo(() => [
    {
      id: 'init_1',
      user: 'system',
      type: 'system',
      text: `Welcome to TheySynced Enterprise Linux OS (GNU/Linux 6.8.0-wasm x86_64)
  * Organization: ${company.name} [ID: ${company.id}]
  * Hostname:     ${hostname}
  * Workspace:    100% Unified Work OS mounted at /workspace
                  - /workspace/chats/        (All company & DM chat history)
                  - /workspace/spreadsheets/ (Financial sheets & CSV tables)
                  - /workspace/drawings/     (Architecture & Excalidraw whiteboards)
                  - /workspace/docs/         (Company documentation & Markdown notes)
                  - /workspace/tasks/        (Team tasks board & to-dos)
                  - /workspace/files/        (Uploaded files, media, and code)
                  - /workspace/export/       (Encrypted backups and tarball dumps)
  * Package Mgr:  Debian APT & Homebrew ('sudo apt update', 'sudo apt install <pkg>')
  * Programming:  Python 3 & Node.js run directly inside browser (install via apt)
  * Visualizer:   Type 'open <file>' to preview in native app tab, or 'gui' for File Manager
  * Superuser:    Type 'sudo su' to enter root mode (#), or prefix with 'sudo'

Type "help" for command manual or press [Tab] for path and command auto-completion.`,
      timestamp: new Date().toISOString(),
    },
  ], [company.name, company.id, hostname]);

  const [logs, setLogs] = useState<TerminalLog[]>(initialLogs);

  // Restore saved terminal logs from D1 asset
  useEffect(() => {
    const termAsset = assets.find((a) => a.id === `terminal_${company.id}`);
    if (termAsset && termAsset.content) {
      try {
        const savedLogs = JSON.parse(termAsset.content);
        if (Array.isArray(savedLogs) && savedLogs.length > 0) {
          setLogs(savedLogs);
        }
      } catch (_) {}
    }
  }, [company.id]);

  // Scroll to bottom
  useEffect(() => {
    if (!nanoActive) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, nanoActive]);

  useEffect(() => {
    if (initialPath) setCwd(initialPath);
  }, [initialPath]);

  const handleContainerClick = () => {
    if (!nanoActive) inputRef.current?.focus();
  };

  // Real-time WebSocket terminal broadcasts
  useEffect(() => {
    if (!websocket) return;

    const handleWs = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'terminal_broadcast' && data.company_id === company.id) {
          setLogs((prev) => {
            if (prev.some((l) => l.id === data.log.id)) return prev;
            return [...prev, data.log];
          });
        }
      } catch (_) {}
    };

    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, company.id]);

  // Append log and broadcast
  const appendLog = (newLog: TerminalLog) => {
    setLogs((prev) => {
      const updated = [...prev, newLog];
      const trimmed = updated.slice(-200);
      onSaveAsset({
        id: `terminal_${company.id}`,
        company_id: company.id,
        asset_type: 'file',
        name: 'shared_terminal_session.log',
        content: JSON.stringify(trimmed),
        created_by: 'system',
        scope: 'shared',
      }).catch(() => {});
      return updated;
    });

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          type: 'terminal_broadcast',
          company_id: company.id,
          log: newLog,
        })
      );
    }
  };

  // Copy terminal text
  const handleCopyBuffer = () => {
    const fullText = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(fullText);
    setCopiedBuffer(true);
    setTimeout(() => setCopiedBuffer(false), 2000);
  };

  // Dynamic on-demand Pyodide loader
  const initPyodide = async () => {
    if (pyodideRef.current) return pyodideRef.current;
    if (isPyodideLoading) return null;

    setIsPyodideLoading(true);
    appendLog({
      id: `sys_load_${Date.now()}`,
      user: 'system',
      type: 'system',
      text: 'Loading CPython 3.12 WebAssembly runtime...',
      timestamp: new Date().toISOString(),
    });

    try {
      if (typeof window !== 'undefined' && !(window as any).loadPyodide) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Pyodide WebAssembly script'));
          document.head.appendChild(script);
        });
      }

      const loadPyodideFn = (window as any).loadPyodide;
      if (!loadPyodideFn) throw new Error('loadPyodide not found');

      const pyodide = await loadPyodideFn({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
      });

      try {
        await pyodide.loadPackage('micropip');
      } catch (_) {}

      pyodideRef.current = pyodide;
      setIsPyodideLoading(false);

      appendLog({
        id: `sys_ready_${Date.now()}`,
        user: 'system',
        type: 'system',
        text: 'Python 3.12 WebAssembly runtime initialized.',
        timestamp: new Date().toISOString(),
      });

      return pyodide;
    } catch (err: any) {
      setIsPyodideLoading(false);
      appendLog({
        id: `err_py_${Date.now()}`,
        user: 'system',
        type: 'error',
        text: `Failed to initialize Python runtime: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      return null;
    }
  };

  // Execute Command via Virtual POSIX Linux Kernel
  const executeCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;

    // 1. Handle Python REPL
    if (isPythonRepl) {
      appendLog({
        id: `repl_${Date.now()}`,
        user: isRoot ? 'root' : user.username,
        type: 'command',
        text: `>>> ${trimmed}`,
        timestamp: new Date().toISOString(),
      });
      setInputVal('');

      if (['exit()', 'quit()', 'exit', 'quit'].includes(trimmed)) {
        setIsPythonRepl(false);
        appendLog({
          id: `out_${Date.now()}`,
          user: 'system',
          type: 'system',
          text: 'Exited Python 3.12 REPL. Back in bash.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const pyodide = await initPyodide();
      if (pyodide) {
        try {
          const res = await pyodide.runPythonAsync(trimmed);
          if (res !== undefined) {
            appendLog({
              id: `out_py_${Date.now()}`,
              user: isRoot ? 'root' : user.username,
              type: 'output',
              text: String(res),
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err: any) {
          appendLog({
            id: `err_py_${Date.now()}`,
            user: isRoot ? 'root' : user.username,
            type: 'error',
            text: `Traceback (most recent call last):\n${err.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }

    // 2. Handle Node.js REPL
    if (isNodeRepl) {
      appendLog({
        id: `repl_node_${Date.now()}`,
        user: isRoot ? 'root' : user.username,
        type: 'command',
        text: `> ${trimmed}`,
        timestamp: new Date().toISOString(),
      });
      setInputVal('');

      if (['.exit', 'exit', 'quit', 'exit()'].includes(trimmed)) {
        setIsNodeRepl(false);
        appendLog({
          id: `out_${Date.now()}`,
          user: 'system',
          type: 'system',
          text: 'Exited Node.js v20.11.0 REPL. Back in bash.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      try {
        const res = new Function(`return (${trimmed});`)();
        if (res !== undefined) {
          appendLog({
            id: `out_node_${Date.now()}`,
            user: isRoot ? 'root' : user.username,
            type: 'output',
            text: typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res),
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err: any) {
        appendLog({
          id: `err_node_${Date.now()}`,
          user: isRoot ? 'root' : user.username,
          type: 'error',
          text: `Uncaught ${err.message}`,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // Normal Prompt Log
    const currentPromptUser = isRoot ? 'root' : user.username;
    const currentPromptSymbol = isRoot ? '#' : '$';

    appendLog({
      id: `cmd_${Date.now()}`,
      user: currentPromptUser,
      type: 'command',
      text: `${currentPromptUser}@${hostname}:${cwd}${currentPromptSymbol} ${trimmed}`,
      timestamp: new Date().toISOString(),
    });

    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setInputVal('');

    // Fast-path client UI commands: clear, help, gui, nano, exit
    if (trimmed === 'clear') {
      setLogs([]);
      return;
    }

    if (trimmed === 'exit' || trimmed === 'logout') {
      if (isRoot) {
        setIsRoot(false);
        appendLog({
          id: `out_${Date.now()}`,
          user: 'system',
          type: 'system',
          text: `logout\nSwitched back to user session: ${user.username}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    if (trimmed === 'gui' || trimmed === 'nautilus' || trimmed === 'explorer') {
      if (onNavigateTab) onNavigateTab('assets', cwd);
      appendLog({
        id: `out_${Date.now()}`,
        user: 'system',
        type: 'system',
        text: `Opened Nautilus GUI File System at "${cwd}".`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (trimmed.startsWith('nano ') || trimmed.startsWith('edit ') || trimmed.startsWith('vi ')) {
      const fileName = trimmed.split(/\s+/)[1];
      if (!fileName) {
        appendLog({ id: `err_${Date.now()}`, user: 'system', type: 'error', text: 'nano: missing file name to edit.', timestamp: new Date().toISOString() });
        return;
      }

      const kernel = kernelRef.current || new LinuxVirtualKernel(company.name, company.id, hostname, installedPackages);
      const filePath = kernel.normalizePath(fileName, cwd, currentPromptUser);
      const [allowed, pErr] = kernel.checkPermission(filePath, currentPromptUser, isRoot, isAdmin);
      if (!allowed) {
        appendLog({ id: `err_${Date.now()}`, user: 'system', type: 'error', text: `nano: ${fileName}: ${pErr}`, timestamp: new Date().toISOString() });
        return;
      }

      const existingContent = kernel.readFile(filePath) || '';
      setNanoFileName(fileName);
      setNanoContent(existingContent);
      setNanoModified(false);
      setNanoActive(true);
      return;
    }

    if (trimmed === 'help' || trimmed === 'man') {
      appendLog({
        id: `out_${Date.now()}`,
        user: 'system',
        type: 'output',
        text: `TheySynced Enterprise Linux Subsystem (GNU/Linux 6.8.0-wasm) [Org: ${company.name}]
Unified Operating System Commands:
  Privileges & Superuser:
    sudo <cmd>                   Execute command as superuser (root)
    sudo su / su                 Switch shell session to root user (#)
    whoami / id                  Show current identity and POSIX UID/GID

  Package Management:
    sudo apt update              Refresh Debian package repository indexes
    sudo apt install <pkg...>    Install packages (e.g. python3, node, git, neofetch, htop, curl, cowsay)
    sudo apt remove <pkg...>     Remove installed package
    apt list [--installed]       List available or installed packages
    brew install <pkg...>        Install formula via Homebrew (e.g. brew install python)
    brew list / brew doctor      List formulae or check Homebrew health

  Runtimes & Compilers:
    python3 <file.py>            Run Python script via WebAssembly (requires: sudo apt install python3)
    python3                      Enter interactive Python 3.12 REPL
    pip install <pkg>            Install Python packages via micropip
    node <file.js>               Run JavaScript code (requires: sudo apt install node)
    node                         Enter interactive Node.js REPL
    npm install / npm init       Node package manager
    gcc <file.c> -o <binary>     Compile C code (requires: sudo apt install gcc)
    git <cmd>                    Git version control (requires: sudo apt install git)

  Diagnostics & Utilities:
    neofetch / fastfetch         Display system hardware and Linux distro ASCII art
    htop / top                   Interactive system process monitor
    curl <url>                   Transfer data over HTTP
    wget <url>                   Download file to current folder
    cowsay <text>                ASCII cow text banner
    figlet <text>                ASCII large letter banner
    task [ls|add|open]           Manage workspace tasks
    browser <url>                In-system browser & localhost dev inspector

  POSIX Core Utilities:
    ls [-l|-a|-h]                List directory contents with octal permissions
    cd <path>                    Change directory (e.g. cd /workspace/chats)
    pwd                          Print working directory
    cat <files...>               Read files (supports pipes | and redirects >)
    head / tail [-n N]           Display first or last lines
    grep [-i|-v] <pat>           Search files or streams using regex
    mkdir [-p] / touch           Create directories and files (auto-syncs to GUI)
    rm [-r] / cp / mv            Remove, copy, or move files (auto-syncs to GUI)
    echo <text> [>|>>]           Print or redirect text to file
    wc [-l|-w|-c]                Count lines, words, bytes
    tree                         Display recursive directory tree
    export-org                   Create encrypted tarball and zip of entire organization
    open <file>                  Open file in visualizer tab (spreadsheet, drawing, doc, etc.)
    gui                          Switch directly to Nautilus graphical file manager`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Execute through LinuxVirtualKernel
    const kernel = kernelRef.current || new LinuxVirtualKernel(company.name, company.id, hostname, installedPackages);
    const result: ShellExecResult = await kernel.executeCommandLine(
      trimmed,
      cwd,
      currentPromptUser,
      isRoot,
      isAdmin
    );

    // Handle user switch (e.g. sudo su)
    if (result.switchUser) {
      if (result.switchUser === 'root') {
        setIsRoot(true);
      } else {
        setIsRoot(false);
      }
    }

    // Handle package changes
    if (result.installedPackagesChanged) {
      await saveInstalledPackages(result.installedPackagesChanged);
    }

    // Handle CWD changes
    if (result.newCwd && result.newCwd !== cwd) {
      setCwd(result.newCwd);
    }

    // Handle File Created or Modified in /workspace (Auto-sync with D1 & GUI)
    if (result.fileCreatedOrModified) {
      const f = result.fileCreatedOrModified;
      const existing = assets.find((a) => a.folder_path === f.folder_path && a.name === f.name);
      const assetType = f.isDir
        ? 'folder'
        : f.name.endsWith('.sheet.json') || f.name.endsWith('.csv')
        ? 'spreadsheet'
        : f.name.endsWith('.excalidraw.json')
        ? 'whiteboard'
        : f.name.endsWith('.doc.json') || f.name.endsWith('.md')
        ? 'doc'
        : f.name.endsWith('.pdf')
        ? 'pdf'
        : 'file';

      await onSaveAsset({
        id: existing ? existing.id : `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        company_id: company.id,
        asset_type: assetType,
        name: f.name,
        folder_path: f.folder_path,
        content: f.content,
        size: f.content.length,
        created_by: isRoot ? 'root' : user.username,
        updated_at: new Date().toISOString(),
        scope: 'shared',
      }).catch(() => {});
    }

    // Handle File Deleted in /workspace (Auto-sync with D1 & GUI)
    if (result.fileDeleted) {
      const delPath = result.fileDeleted.path;
      const matchingAsset = assets.find((a) => {
        const full = a.folder_path ? `${a.folder_path}/${a.name}`.replace(/\/+/g, '/') : a.name;
        return full === delPath || a.id === delPath.split('/').pop();
      });
      if (matchingAsset) {
        await onDeleteAsset(matchingAsset.id).catch(() => {});
      }
    }

    // Handle Python execution request
    if (result.output === '__RUN_PYODIDE_OR_REPL__') {
      const parts = trimmed.replace(/^sudo\s+/, '').split(/\s+/);
      const pyArgs = parts.slice(1);

      if (pyArgs.length === 0) {
        setIsPythonRepl(true);
        appendLog({
          id: `out_py_${Date.now()}`,
          user: 'system',
          type: 'system',
          text: `Python 3.12.0 (Pyodide WebAssembly) on linux\nType "exit()" or "quit()" to return to bash shell.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const pyodide = await initPyodide();
      if (pyodide) {
        try {
          if (pyArgs[0] === '-c') {
            const code = pyArgs.slice(1).join(' ').replace(/^["']|["']$/g, '');
            const pyRes = await pyodide.runPythonAsync(code);
            if (pyRes !== undefined) {
              appendLog({ id: `out_${Date.now()}`, user: currentPromptUser, type: 'output', text: String(pyRes), timestamp: new Date().toISOString() });
            }
          } else {
            const scriptPath = kernel.normalizePath(pyArgs[0], cwd, currentPromptUser);
            const scriptContent = kernel.readFile(scriptPath);
            if (scriptContent === null) {
              appendLog({ id: `err_${Date.now()}`, user: currentPromptUser, type: 'error', text: `python3: can't open file '${pyArgs[0]}': [Errno 2] No such file or directory`, timestamp: new Date().toISOString() });
            } else {
              const pyRes = await pyodide.runPythonAsync(scriptContent);
              if (pyRes !== undefined) {
                appendLog({ id: `out_${Date.now()}`, user: currentPromptUser, type: 'output', text: String(pyRes), timestamp: new Date().toISOString() });
              }
            }
          }
        } catch (pyErr: any) {
          appendLog({ id: `err_${Date.now()}`, user: currentPromptUser, type: 'error', text: `Python error: ${pyErr.message}`, timestamp: new Date().toISOString() });
        }
      }
      return;
    }

    // Handle pip execution request
    if (result.output === '__RUN_PYODIDE_PIP__') {
      const parts = trimmed.replace(/^sudo\s+/, '').split(/\s+/);
      const pyodide = await initPyodide();
      if (pyodide) {
        if (parts[1] === 'install' && parts[2]) {
          appendLog({ id: `out_${Date.now()}`, user: 'system', type: 'system', text: `Collecting ${parts[2]}...\nInstalling collected packages: ${parts[2]} via micropip...`, timestamp: new Date().toISOString() });
          try {
            await pyodide.loadPackage(parts[2]);
            appendLog({ id: `out_${Date.now()}`, user: 'system', type: 'output', text: `Successfully installed ${parts[2]}`, timestamp: new Date().toISOString() });
          } catch (e: any) {
            appendLog({ id: `err_${Date.now()}`, user: 'system', type: 'error', text: `pip install error: ${e.message}`, timestamp: new Date().toISOString() });
          }
        } else {
          appendLog({ id: `out_${Date.now()}`, user: 'system', type: 'output', text: 'Usage: pip install <package>', timestamp: new Date().toISOString() });
        }
      }
      return;
    }

    // Handle Node REPL request
    if (result.enterNodeRepl) {
      setIsNodeRepl(true);
      appendLog({
        id: `out_node_${Date.now()}`,
        user: 'system',
        type: 'system',
        text: `Welcome to Node.js v20.11.0.\nType ".exit" to return to bash shell.`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (result.output) {
      appendLog({
        id: `out_${Date.now()}`,
        user: currentPromptUser,
        type: 'output',
        text: result.output,
        timestamp: new Date().toISOString(),
      });
    }

    if (result.error) {
      appendLog({
        id: `err_${Date.now()}`,
        user: currentPromptUser,
        type: 'error',
        text: result.error,
        timestamp: new Date().toISOString(),
      });
    }

    if (result.openTab && onNavigateTab) {
      onNavigateTab(result.openTab as ActiveTab, result.openId);
    }
  };

  // Keyboard Navigation & Shortcuts (Enter, Tab, Up/Down History, Ctrl+C, Ctrl+L, Ctrl+U)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 1. Enter: execute command
    if (e.key === 'Enter') {
      executeCommand(inputVal);
      return;
    }

    // 2. Tab: auto-completion
    if (e.key === 'Tab') {
      e.preventDefault();
      const kernel = kernelRef.current;
      if (!kernel || !inputVal.trim()) return;

      const currentPromptUser = isRoot ? 'root' : user.username;
      const completions = kernel.getCompletions(inputVal, cwd, currentPromptUser);

      if (completions.length === 1) {
        const match = completions[0];
        const trimmed = inputVal.trimStart();
        const tokens = trimmed.split(/\s+/);

        if (tokens.length === 1 && !inputVal.endsWith(' ')) {
          setInputVal(match + ' ');
        } else {
          const lastToken = tokens[tokens.length - 1];
          if (lastToken.includes('/')) {
            const lastSlash = lastToken.lastIndexOf('/');
            const prefix = lastToken.substring(0, lastSlash + 1);
            tokens[tokens.length - 1] = prefix + match;
          } else {
            tokens[tokens.length - 1] = match;
          }
          setInputVal(tokens.join(' '));
        }
      } else if (completions.length > 1) {
        // Display completions in terminal output
        appendLog({
          id: `tab_${Date.now()}`,
          user: 'system',
          type: 'output',
          text: completions.join('    '),
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // 3. Ctrl+C: Cancel current input
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      const currentPromptUser = isRoot ? 'root' : user.username;
      const currentPromptSymbol = isRoot ? '#' : '$';
      appendLog({
        id: `cancel_${Date.now()}`,
        user: currentPromptUser,
        type: 'command',
        text: `${currentPromptUser}@${hostname}:${cwd}${currentPromptSymbol} ${inputVal}^C`,
        timestamp: new Date().toISOString(),
      });
      setInputVal('');
      return;
    }

    // 4. Ctrl+L: Clear screen
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      setLogs([]);
      return;
    }

    // 5. Ctrl+U: Clear line
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      setInputVal('');
      return;
    }

    // 6. Up Arrow: History backward
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIdx);
        setInputVal(history[nextIdx] || '');
      }
      return;
    }

    // 7. Down Arrow: History forward
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length > 0 && historyIndex !== -1) {
        const nextIdx = historyIndex + 1;
        if (nextIdx >= history.length) {
          setHistoryIndex(-1);
          setInputVal('');
        } else {
          setHistoryIndex(nextIdx);
          setInputVal(history[nextIdx] || '');
        }
      }
      return;
    }
  };

  // Nano text editor handlers
  const handleNanoSave = async () => {
    const kernel = kernelRef.current;
    if (kernel) {
      const p = kernel.normalizePath(nanoFileName, cwd, isRoot ? 'root' : user.username);
      kernel.writeFile(p, nanoContent, isRoot ? 'root' : user.username);
    }
    setNanoModified(false);

    // Save to company assets
    await onSaveAsset({
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      company_id: company.id,
      asset_type: 'file',
      name: nanoFileName,
      folder_path: cwd,
      content: nanoContent,
      size: nanoContent.length,
      created_by: isRoot ? 'root' : user.username,
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });

    appendLog({
      id: `out_${Date.now()}`,
      user: 'system',
      type: 'system',
      text: `[ Wrote ${nanoContent.length} bytes to ${nanoFileName} ]`,
      timestamp: new Date().toISOString(),
    });
  };

  const handleNanoExit = () => {
    setNanoActive(false);
    appendLog({
      id: `out_${Date.now()}`,
      user: 'system',
      type: 'system',
      text: `Exited nano editor. Returned to ${cwd}.`,
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <div className={`flex-1 flex flex-col h-full bg-[#0a0d14] text-slate-100 font-mono ${fontSize} select-text overflow-hidden`}>
      
      {/* Sleek Terminal Header */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center space-x-3">
          {/* macOS Window Controls */}
          <div className="flex items-center space-x-1.5">
            <button 
              onClick={() => setLogs([])} 
              className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 transition" 
              title="Clear Terminal Output" 
            />
            <button 
              onClick={() => setFontSize(prev => prev === 'text-xs' ? 'text-sm' : prev === 'text-sm' ? 'text-base' : 'text-xs')} 
              className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 transition" 
              title="Toggle Font Size" 
            />
            <button 
              className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 transition" 
              title="Linux Terminal Active" 
            />
          </div>

          <div className="flex items-center space-x-2">
            <TerminalIcon className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white tracking-tight">Linux Terminal</span>
            <span className="hidden sm:inline bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded border border-white/10 font-sans">
              {isRoot ? 'root' : user.username}@{hostname}
            </span>
            <span className="hidden md:inline bg-slate-800/80 text-cyan-300 text-[11px] px-2 py-0.5 rounded border border-cyan-500/20">
              {cwd}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('assets', cwd)}
              className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 transition"
              title="Open current directory in Nautilus File System GUI"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Nautilus GUI</span>
            </button>
          )}

          <button
            onClick={handleCopyBuffer}
            className="flex items-center space-x-1 px-2 py-1 hover:text-white rounded hover:bg-slate-800 border border-transparent hover:border-white/10 transition"
            title="Copy all terminal output"
          >
            {copiedBuffer ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copiedBuffer ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={() => setLogs([])}
            className="p-1 hover:text-white rounded hover:bg-slate-800 transition"
            title="Clear Terminal Output"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Terminal Viewport / Editor */}
      {nanoActive ? (
        <div className="flex-1 flex flex-col bg-[#05080f] select-text">
          <div className="bg-slate-800 text-slate-200 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono border-b border-white/10">
            <span>GNU nano 7.2 &bull; File: <strong>{nanoFileName}</strong> {nanoModified && <span className="text-amber-400 font-bold">[Modified]</span>}</span>
            <div className="flex items-center space-x-2">
              <button onClick={handleNanoSave} className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold">
                <Save className="w-3 h-3" />
                <span>Save (^O)</span>
              </button>
              <button onClick={handleNanoExit} className="flex items-center space-x-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold">
                <X className="w-3 h-3" />
                <span>Exit (^X)</span>
              </button>
            </div>
          </div>

          <textarea
            ref={nanoTextareaRef}
            value={nanoContent}
            onChange={(e) => {
              setNanoContent(e.target.value);
              setNanoModified(true);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 's')) {
                e.preventDefault();
                handleNanoSave();
              } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
                e.preventDefault();
                handleNanoExit();
              }
            }}
            placeholder="# Edit code, data, or configuration here..."
            className="flex-1 p-4 bg-transparent text-emerald-300 font-mono text-xs outline-none resize-none leading-relaxed"
            autoFocus
          />

          <div className="bg-slate-900 border-t border-white/10 px-4 py-1.5 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400 font-mono">
            <div><span className="bg-white/20 text-white px-1 rounded mr-1">^O</span> WriteOut (Save)</div>
            <div><span className="bg-white/20 text-white px-1 rounded mr-1">^X</span> Exit nano</div>
            <div><span className="bg-white/20 text-white px-1 rounded mr-1">^K</span> Cut text</div>
            <div><span className="bg-white/20 text-white px-1 rounded mr-1">^U</span> Paste text</div>
          </div>
        </div>
      ) : (
        <div 
          onClick={handleContainerClick}
          className="flex-1 p-4 overflow-y-auto space-y-2 select-text cursor-text bg-[#0a0d14]"
        >
          {logs.map((log) => {
            if (log.type === 'command') {
              return (
                <div key={log.id} className="text-emerald-400 font-semibold break-words">
                  {log.text}
                </div>
              );
            }
            if (log.type === 'system') {
              return (
                <div key={log.id} className="text-slate-400 italic whitespace-pre-wrap leading-relaxed py-0.5 border-l-2 border-indigo-500/50 pl-2.5 my-1">
                  {log.text}
                </div>
              );
            }
            if (log.type === 'error') {
              return (
                <div key={log.id} className="text-rose-400 whitespace-pre-wrap leading-relaxed">
                  {log.text}
                </div>
              );
            }
            return (
              <div key={log.id} className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                {log.text}
              </div>
            );
          })}

          <div className="flex items-center space-x-2 pt-1">
            {isPythonRepl ? (
              <span className="text-amber-400 font-bold shrink-0">&gt;&gt;&gt;&nbsp;</span>
            ) : isNodeRepl ? (
              <span className="text-emerald-400 font-bold shrink-0">&gt;&nbsp;</span>
            ) : isRoot ? (
              <span className="shrink-0 flex items-center space-x-1 select-none">
                <span className="text-rose-500 font-bold">root</span>
                <span className="text-slate-500">@</span>
                <span className="text-cyan-400 font-bold">{hostname}</span>
                <span className="text-slate-500">:</span>
                <span className="text-blue-400 font-bold">{cwd}</span>
                <span className="text-rose-500 font-bold">#</span>
              </span>
            ) : (
              <span className="shrink-0 flex items-center space-x-1 select-none">
                <span className="text-emerald-400 font-bold">{user.username}</span>
                <span className="text-slate-500">@</span>
                <span className="text-cyan-400 font-bold">{hostname}</span>
                <span className="text-slate-500">:</span>
                <span className="text-blue-400 font-bold">{cwd}</span>
                <span className="text-amber-400 font-bold">$</span>
              </span>
            )}
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-white font-mono outline-none caret-emerald-400"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div ref={terminalEndRef} />
        </div>
      )}

      {/* Terminal Footer Info Bar & Quick Action Chips */}
      <div className="bg-[#12161f] border-t border-white/10 px-4 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-sans shrink-0 gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            Distro: <strong className="text-white ml-1 font-mono">TheySynced Linux 6.8.0</strong>
          </span>
          <span className="hidden sm:inline text-slate-400">
            &bull; Packages: <strong className="text-slate-300 font-mono">{installedPackages.length} active</strong>
          </span>
        </div>

        {/* Clickable Quick Command Chips */}
        <div className="flex items-center space-x-1.5 overflow-x-auto py-0.5">
          <span className="text-slate-500 text-[10px] hidden md:inline">Quick commands:</span>
          <button
            onClick={() => executeCommand('sudo apt update')}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded font-mono text-[10px] border border-white/5 transition"
          >
            apt update
          </button>
          <button
            onClick={() => executeCommand('sudo apt install python3')}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded font-mono text-[10px] border border-white/5 transition"
          >
            apt install python3
          </button>
          <button
            onClick={() => executeCommand('ls -la')}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded font-mono text-[10px] border border-white/5 transition"
          >
            ls -la
          </button>
          <button
            onClick={() => executeCommand('neofetch')}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded font-mono text-[10px] border border-white/5 transition"
          >
            neofetch
          </button>
          <button
            onClick={() => executeCommand('task ls')}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded font-mono text-[10px] border border-white/5 transition"
          >
            task ls
          </button>
          <button
            onClick={() => executeCommand('gui')}
            className="px-2 py-0.5 bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 rounded font-mono text-[10px] border border-indigo-500/20 transition"
          >
            gui
          </button>
        </div>
      </div>

    </div>
  );
};
