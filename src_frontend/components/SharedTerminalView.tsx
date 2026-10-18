'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, RotateCcw, FolderGit2, Download, 
  Check, Copy, Sparkles, ExternalLink, HardDrive, Cpu, Radio, Clipboard, Trash2, Maximize2
} from 'lucide-react';
import { buildCompanyLinuxFilesystem, LinuxFileEntry } from '../lib/linuxFilesystem';
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

  const [cwd, setCwd] = useState<string>(initialPath || '/workspace');
  const [isRoot, setIsRoot] = useState<boolean>(false);
  const [installedPkgs, setInstalledPkgs] = useState<Set<string>>(new Set(['base', 'linux', 'bash', 'coreutils', 'pacman']));
  const [isPythonRepl, setIsPythonRepl] = useState<boolean>(false);
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);

  // In-memory VFS representing company files
  const vfsRef = useRef<Map<string, { content: string; isDir: boolean; mode: string }>>(new Map());

  const hostname = useMemo(() => {
    const slug = (company.name || 'org')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'theysynced';
    return `arch-${slug}`;
  }, [company.name]);

  // Build unified Linux filesystem entries from company state
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Sync VFS with linuxEntries
  useEffect(() => {
    const vfs = new Map<string, { content: string; isDir: boolean; mode: string }>();
    
    // Core standard Arch Linux directories
    const standardDirs = [
      '/', '/bin', '/sbin', '/usr', '/usr/bin', '/usr/lib', '/etc', '/var', 
      '/var/lib', '/var/lib/pacman', '/tmp', '/home', `/home/${user.username}`, 
      '/root', '/workspace', '/workspace/chats', '/workspace/spreadsheets', 
      '/workspace/drawings', '/workspace/docs', '/workspace/tasks', '/workspace/files', '/workspace/export'
    ];
    standardDirs.forEach(d => vfs.set(d, { content: '', isDir: true, mode: 'drwxr-xr-x' }));

    // Mount company entries
    for (const e of linuxEntries) {
      vfs.set(e.path, {
        content: e.content || '',
        isDir: e.type === 'folder',
        mode: e.mode || (e.type === 'folder' ? 'drwxr-xr-x' : '-rw-r--r--'),
      });
    }

    // Arch release info
    vfs.set('/etc/os-release', {
      content: `NAME="Arch Linux"\nPRETTY_NAME="Arch Linux x86_64 (TheySynced Custom Rolling)"\nID=arch\nBUILD_ID=rolling\nANSI_COLOR="38;2;23;147;209"\nHOME_URL="https://archlinux.org/"\n`,
      isDir: false,
      mode: '-rw-r--r--',
    });
    vfs.set('/etc/hostname', { content: `${hostname}\n`, isDir: false, mode: '-rw-r--r--' });

    vfsRef.current = vfs;
  }, [linuxEntries, user.username, hostname]);

  // Prompt generator
  const getPrompt = (dir = cwd, root = isRoot) => {
    const userPart = root 
      ? `\x1b[1;31mroot\x1b[0m@\x1b[1;36m${hostname}\x1b[0m` 
      : `\x1b[1;32m${user.username}\x1b[0m@\x1b[1;36m${hostname}\x1b[0m`;
    const pathPart = `\x1b[1;34m${dir}\x1b[0m`;
    const symbol = root ? `\x1b[1;31m#\x1b[0m ` : `\x1b[1;33m$\x1b[0m `;
    return `[${userPart} ${pathPart}]${symbol}`;
  };

  // Arch Linux Neofetch Graphic
  const renderArchNeofetch = () => {
    return `\x1b[1;36m                   -\`                    \x1b[1;32m${user.username}\x1b[0m@\x1b[1;36m${hostname}\x1b[0m
\x1b[1;36m                  .o+\`                   \x1b[0;37m--------------------\x1b[0m
\x1b[1;36m                 \`ooo/                   \x1b[1;37mOS:\x1b[0m Arch Linux x86_64
\x1b[1;36m                \`+oooo:                  \x1b[1;37mHost:\x1b[0m TheySynced Work OS (v0.2.0)
\x1b[1;36m               \`+oooooo:                 \x1b[1;37mKernel:\x1b[0m 6.10.8-arch1-1-theysynced
\x1b[1;36m               -+oooooo+:                \x1b[1;37mUptime:\x1b[0m 5 hours, 12 mins
\x1b[1;36m             \`/:-:++oooo+:               \x1b[1;37mPackages:\x1b[0m ${installedPkgs.size + 342} (pacman)
\x1b[1;36m            \`/++++/+++++++:              \x1b[1;37mShell:\x1b[0m bash 5.2.32
\x1b[1;36m           \`/++++++++++++++:             \x1b[1;37mTerminal:\x1b[0m xterm.js (Canvas/DOM)
\x1b[1;36m          \`/+++ooooooooooooo/\`           \x1b[1;37mCPU:\x1b[0m AMD EPYC 7763 (64) @ 2.45GHz
\x1b[1;36m         ./ooosssso++osssssso+\`          \x1b[1;37mMemory:\x1b[0m 2140MiB / 8192MiB
\x1b[1;36m        .oossssso-\`\`\`\`/ossssss+\`         \x1b[1;37mDisk:\x1b[0m 42GB / 128GB (ext4 /workspace)
\x1b[1;36m       -osssssso.      :ssssssso.        \x1b[1;37mClipboard:\x1b[0m Native Cmd+C / Cmd+V
\x1b[1;36m      :osssssss/        osssso+++.       \x1b[1;37mOrganization:\x1b[0m ${company.name} [ID: ${company.id}]
\x1b[1;36m     /ossssssss/        +ssssooo/-       
\x1b[1;36m   \`/ossssso+/:-        -:/+osssso+-     
\x1b[1;36m  \`+sso+:-\`                 \`.-/+oso:    
\x1b[1;36m \`++:.                           \`-/+/   
\x1b[1;36m .\`                                 \`/   \x1b[0m`;
  };

  // Execute Shell Command Line
  const executeCommandLine = async (term: any, cmdLine: string) => {
    let line = cmdLine.trim();
    if (!line) {
      term.write('\r\n' + getPrompt());
      return;
    }

    term.write('\r\n');

    // Handle /bin/bash -c "..." or bash -c "..."
    if (line.startsWith('/bin/bash -c ') || line.startsWith('bash -c ') || line.startsWith('sh -c ')) {
      const match = line.match(/-c\s+["'](.*)["']/s) || line.match(/-c\s+(.*)/);
      if (match && match[1]) {
        line = match[1].trim();
      }
    }

    // Handle Homebrew install script invocation: gracefully map to Arch pacman
    if (line.includes('Homebrew/install') || line.includes('install.sh')) {
      term.writeln('\x1b[1;34m==>\x1b[0m \x1b[1mArch Linux detected: Homebrew script mapped to native pacman!\x1b[0m');
      term.writeln('\x1b[1;32m==>\x1b[0m Installing base development tools via pacman...');
      term.writeln(':: Synchronizing package databases...');
      term.writeln(' resolving dependencies...');
      term.writeln(' Packages (3) gcc-14.2.0 make-4.4.1 git-2.46.0');
      term.writeln(' [####################################] 100%');
      term.writeln('\x1b[1;32m==>\x1b[0m Installation successful! Run \x1b[1;33mpacman -S <pkg>\x1b[0m to install any tool.');
      term.write(getPrompt());
      return;
    }

    // Handle clear
    if (line === 'clear' || line === 'cls') {
      term.write('\x1b[2J\x1b[3J\x1b[H');
      term.write(getPrompt());
      return;
    }

    // Handle su / sudo su
    if (line === 'sudo su' || line === 'su' || line === 'su root') {
      setIsRoot(true);
      term.writeln('\x1b[1;32mSwitched session to superuser (root).\x1b[0m');
      term.write(getPrompt(cwd, true));
      return;
    }
    if (line === 'exit' || line === 'logout') {
      if (isRoot) {
        setIsRoot(false);
        term.writeln('logout: Switched back to normal user.');
        term.write(getPrompt(cwd, false));
        return;
      }
    }

    // Handle uname
    if (line === 'uname' || line.startsWith('uname ')) {
      if (line.includes('-a')) {
        term.writeln(`Linux ${hostname} 6.10.8-arch1-1-theysynced #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`);
      } else if (line.includes('-r')) {
        term.writeln('6.10.8-arch1-1-theysynced');
      } else {
        term.writeln('Linux');
      }
      term.write(getPrompt());
      return;
    }

    // Handle whoami & id
    if (line === 'whoami') {
      term.writeln(isRoot ? 'root' : user.username);
      term.write(getPrompt());
      return;
    }
    if (line === 'id') {
      term.writeln(isRoot 
        ? 'uid=0(root) gid=0(root) groups=0(root),1(bin),2(daemon),10(wheel)' 
        : `uid=1000(${user.username}) gid=1000(${user.username}) groups=1000(${user.username}),10(wheel),998(theysynced)`);
      term.write(getPrompt());
      return;
    }

    // Handle hostname
    if (line === 'hostname') {
      term.writeln(hostname);
      term.write(getPrompt());
      return;
    }

    // Handle neofetch / fastfetch
    if (line === 'neofetch' || line === 'fastfetch') {
      term.writeln(renderArchNeofetch());
      term.write(getPrompt());
      return;
    }

    // Handle pacman
    if (line.startsWith('pacman') || line.startsWith('sudo pacman') || line.startsWith('yay') || line.startsWith('paru') || line.startsWith('apt') || line.startsWith('sudo apt')) {
      const parts = line.replace(/^sudo\s+/, '').split(/\s+/);
      const sub = parts[1] || '';
      const pkg = parts[2] || '';

      if (sub === '-Syu' || sub === '-Syyu' || sub === 'update' || sub === 'upgrade') {
        term.writeln(':: Synchronizing package databases...');
        term.writeln(' core is up to date');
        term.writeln(' extra is up to date');
        term.writeln(' multilib is up to date');
        term.writeln(':: Starting full system upgrade...');
        term.writeln(' there is nothing to do');
      } else if (sub.startsWith('-S') || sub === 'install') {
        if (!pkg) {
          term.writeln('error: no targets specified (use -h for help)');
        } else {
          setInstalledPkgs(prev => new Set([...Array.from(prev), pkg]));
          term.writeln(`resolving dependencies...`);
          term.writeln(`looking for conflicting packages...`);
          term.writeln(`\r\nPackages (1) ${pkg}-latest-x86_64`);
          term.writeln(`Total Download Size:   3.42 MiB`);
          term.writeln(`Total Installed Size: 14.80 MiB\r\n`);
          term.writeln(`:: Proceed with installation? [Y/n] y`);
          term.writeln(`:: Retrieving packages...`);
          term.writeln(` ${pkg} [####################################] 100%`);
          term.writeln(`(1/1) checking keys in keyring        [####################################] 100%`);
          term.writeln(`(1/1) checking package integrity      [####################################] 100%`);
          term.writeln(`(1/1) loading package files           [####################################] 100%`);
          term.writeln(`(1/1) installing ${pkg}               [####################################] 100%`);
          term.writeln(`:: Running post-transaction hooks...`);
          term.writeln(`(1/1) Arming ConditionNeedsUpdate...`);
          term.writeln(`\x1b[1;32m✓ ${pkg} installed successfully into /usr/bin/${pkg}\x1b[0m`);
        }
      } else if (sub === '-Q' || sub === 'list') {
        term.writeln(Array.from(installedPkgs).join('  '));
      } else {
        term.writeln(`usage:  pacman <operation> [...]`);
        term.writeln(`operations:`);
        term.writeln(`  pacman {-S --sync} [options] [package(s)]`);
        term.writeln(`  pacman {-Syu}      (Full rolling system update)`);
        term.writeln(`  pacman {-Q --query} [options] [package(s)]`);
      }
      term.write(getPrompt());
      return;
    }

    // Handle pwd
    if (line === 'pwd') {
      term.writeln(cwd);
      term.write(getPrompt());
      return;
    }

    // Handle cd
    if (line === 'cd' || line.startsWith('cd ')) {
      const target = line.split(/\s+/)[1] || '/workspace';
      let nextDir = cwd;
      if (target === '/') nextDir = '/';
      else if (target === '~') nextDir = `/home/${user.username}`;
      else if (target === '..') {
        const parts = cwd.split('/').filter(Boolean);
        parts.pop();
        nextDir = '/' + parts.join('/');
      } else if (target.startsWith('/')) {
        nextDir = target;
      } else {
        nextDir = cwd === '/' ? `/${target}` : `${cwd}/${target}`;
      }
      setCwd(nextDir);
      term.write(getPrompt(nextDir));
      return;
    }

    // Handle ls
    if (line === 'ls' || line.startsWith('ls ') || line === 'dir') {
      const vfs = vfsRef.current;
      const targetDir = cwd;
      const prefix = targetDir === '/' ? '/' : `${targetDir}/`;
      const items: string[] = [];

      for (const [p, n] of vfs.entries()) {
        if (p !== targetDir && p.startsWith(prefix)) {
          const rel = p.slice(prefix.length);
          if (!rel.includes('/')) {
            if (n.isDir) {
              items.push(`\x1b[1;34m${rel}/\x1b[0m`);
            } else if (rel.endsWith('.sh') || rel.endsWith('.py')) {
              items.push(`\x1b[1;32m${rel}*\x1b[0m`);
            } else {
              items.push(`\x1b[0;37m${rel}\x1b[0m`);
            }
          }
        }
      }

      if (items.length === 0) {
        term.writeln('\x1b[2m(empty directory)\x1b[0m');
      } else {
        term.writeln(items.join('   '));
      }
      term.write(getPrompt());
      return;
    }

    // Handle cat
    if (line.startsWith('cat ') || line.startsWith('head ') || line.startsWith('tail ')) {
      const fileName = line.split(/\s+/)[1];
      const fullPath = fileName?.startsWith('/') ? fileName : (cwd === '/' ? `/${fileName}` : `${cwd}/${fileName}`);
      const file = vfsRef.current.get(fullPath);
      if (file && !file.isDir) {
        term.writeln(file.content);
      } else if (file && file.isDir) {
        term.writeln(`cat: ${fileName}: Is a directory`);
      } else {
        term.writeln(`cat: ${fileName}: No such file or directory`);
      }
      term.write(getPrompt());
      return;
    }

    // Handle touch
    if (line.startsWith('touch ')) {
      const fname = line.split(/\s+/)[1];
      if (fname) {
        const fullPath = fname.startsWith('/') ? fname : (cwd === '/' ? `/${fname}` : `${cwd}/${fname}`);
        vfsRef.current.set(fullPath, { content: '', isDir: false, mode: '-rw-r--r--' });
        if (fullPath.startsWith('/workspace')) {
          const name = fullPath.split('/').pop() || fname;
          const folder_path = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/workspace';
          onSaveAsset({
            id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            company_id: company.id,
            asset_type: 'file',
            name,
            folder_path,
            content: '',
            size: 0,
            created_by: user.username,
            scope: 'shared',
          }).catch(() => {});
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle mkdir
    if (line.startsWith('mkdir ')) {
      const dname = line.split(/\s+/).find(p => !p.startsWith('-') && p !== 'mkdir');
      if (dname) {
        const fullPath = dname.startsWith('/') ? dname : (cwd === '/' ? `/${dname}` : `${cwd}/${dname}`);
        vfsRef.current.set(fullPath, { content: '', isDir: true, mode: 'drwxr-xr-x' });
        if (fullPath.startsWith('/workspace')) {
          onSaveAsset({
            id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            company_id: company.id,
            asset_type: 'folder',
            name: dname.split('/').pop() || dname,
            folder_path: fullPath.substring(0, fullPath.lastIndexOf('/')) || '/workspace',
            content: '',
            created_by: user.username,
            scope: 'shared',
          }).catch(() => {});
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle rm
    if (line.startsWith('rm ') || line.startsWith('rmdir ')) {
      const target = line.split(/\s+/).find(p => !p.startsWith('-') && p !== 'rm' && p !== 'rmdir');
      if (target) {
        const fullPath = target.startsWith('/') ? target : (cwd === '/' ? `/${target}` : `${cwd}/${target}`);
        vfsRef.current.delete(fullPath);
        if (fullPath.startsWith('/workspace')) {
          const matching = assets.find(a => {
            const p = a.folder_path ? `${a.folder_path}/${a.name}`.replace(/\/+/g, '/') : a.name;
            return p === fullPath || a.name === target;
          });
          if (matching) onDeleteAsset(matching.id).catch(() => {});
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle open <file>
    if (line.startsWith('open ') || line === 'open' || line === 'gui' || line === 'nautilus') {
      const target = line.split(/\s+/)[1] || '';
      if (!target || line === 'gui' || line === 'nautilus') {
        if (onNavigateTab) onNavigateTab('assets', cwd);
        term.writeln(`\x1b[1;32mOpening Nautilus GUI at ${cwd}...\x1b[0m`);
      } else {
        const basename = target.split('/').pop() || '';
        if (basename.includes('sheet') || basename.endsWith('.csv')) {
          if (onNavigateTab) onNavigateTab('spreadsheet', basename);
          term.writeln(`\x1b[1;32mOpening '${basename}' in Spreadsheets Tab...\x1b[0m`);
        } else if (basename.includes('excalidraw')) {
          if (onNavigateTab) onNavigateTab('whiteboard', basename);
          term.writeln(`\x1b[1;32mOpening '${basename}' in Whiteboards Canvas...\x1b[0m`);
        } else if (basename.includes('doc') || basename.endsWith('.md')) {
          if (onNavigateTab) onNavigateTab('docs', basename);
          term.writeln(`\x1b[1;32mOpening '${basename}' in Docs Tab...\x1b[0m`);
        } else if (basename.includes('task')) {
          if (onNavigateTab) onNavigateTab('tasks', basename);
          term.writeln(`\x1b[1;32mOpening Tasks Board...\x1b[0m`);
        } else {
          if (onNavigateTab) onNavigateTab('assets', cwd);
          term.writeln(`\x1b[1;32mOpening '${basename}' in File Manager...\x1b[0m`);
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle task CLI
    if (line === 'task' || line.startsWith('task ') || line === 'tasks') {
      const taskAsset = assets.find(a => a.id === `tasks_${company.id}` || a.name === 'tasks.json');
      if (taskAsset && taskAsset.content) {
        try {
          const tasks = JSON.parse(taskAsset.content);
          term.writeln(`\x1b[1mTheySynced Tasks Board (${tasks.length} total)\x1b[0m`);
          term.writeln(`${'ID'.padEnd(8)} ${'STATUS'.padEnd(14)} ${'PRIORITY'.padEnd(10)} TITLE`);
          term.writeln('-'.repeat(60));
          for (const t of tasks.slice(0, 10)) {
            const stColor = t.status === 'done' ? '\x1b[32m' : t.status === 'in_progress' ? '\x1b[33m' : '\x1b[36m';
            term.writeln(`${t.id.slice(0, 7).padEnd(8)} ${stColor}${t.status.padEnd(14)}\x1b[0m ${(t.priority || 'medium').padEnd(10)} ${t.title}`);
          }
        } catch {
          term.writeln('No active tasks found.');
        }
      } else {
        term.writeln('No active tasks found. Open Tasks tab to create one.');
      }
      term.write(getPrompt());
      return;
    }

    // Handle help
    if (line === 'help' || line === 'man') {
      term.writeln(`\x1b[1;36mTheySynced Arch Linux Subsystem (v6.10.8-arch1-1)\x1b[0m`);
      term.writeln(`Core Commands:`);
      term.writeln(`  pacman -Syu                  Update all package databases`);
      term.writeln(`  pacman -S <pkg>              Install package (e.g. python, gcc, git, neofetch, htop)`);
      term.writeln(`  pacman -Q                    List installed packages`);
      term.writeln(`  ls, cd, pwd, cat, mkdir, rm  Standard POSIX file operations`);
      term.writeln(`  open <file>                  Open spreadsheet, drawing, doc, or task in native UI`);
      term.writeln(`  gui / nautilus               Switch to Nautilus graphical file manager`);
      term.writeln(`  neofetch                     Display Arch Linux ASCII logo & system stats`);
      term.writeln(`  task                         List organization tasks`);
      term.writeln(`  uname -a, whoami, id         Display kernel and user credentials`);
      term.writeln(`  clear                        Clear terminal screen`);
      term.write(getPrompt());
      return;
    }

    // Fallback: execute or command echo
    term.writeln(`[arch: executed '${line}']`);
    term.write(getPrompt());
  };

  // Initialize xterm.js
  useEffect(() => {
    let term: any = null;
    let isCancelled = false;

    async function initXterm() {
      if (!terminalRef.current) return;

      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      if (isCancelled) return;

      // Clean container
      terminalRef.current.innerHTML = '';

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.25,
        convertEol: true,
        theme: {
          background: '#0a0d14',
          foreground: '#e2e8f0',
          cursor: '#38bdf8',
          selectionBackground: '#1e293b',
          black: '#0a0d14',
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

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      xtermInstance.current = term;
      fitAddonRef.current = fitAddon;

      // Welcome Banner
      term.writeln('\x1b[1;36m   __ _ _ __ ___| |__     |  \x1b[1;37mTheySynced Arch Linux Work OS \x1b[0;36m(v6.10.8-arch1-1 x86_64)\x1b[0m');
      term.writeln('\x1b[1;36m  / _` | \'__/ __| \'_ \\    |  \x1b[0;37mWorkspace: \x1b[1;34m/workspace\x1b[0;37m (All company files mounted)\x1b[0m');
      term.writeln('\x1b[1;36m | (_| | | | (__| | | |   |  \x1b[0;37mPackage Mgr: \x1b[1;33mpacman\x1b[0;37m (\'pacman -S <pkg>\', \'pacman -Syu\')\x1b[0m');
      term.writeln('\x1b[1;36m  \\__,_|_|  \\___|_| |_|   |  \x1b[0;37mClipboard: Native Cmd+C / Cmd+V fully supported\x1b[0m\r\n');
      term.writeln('Type \x1b[1;32mhelp\x1b[0m for commands, \x1b[1;32mneofetch\x1b[0m for system info, or \x1b[1;32mpacman -Syu\x1b[0m to update.\r\n');
      term.write(getPrompt('/workspace', false));

      let currentInput = '';
      let cmdHistory: string[] = [];
      let historyIdx = -1;

      // Keystroke listener
      term.onData((data: string) => {
        // Enter
        if (data === '\r') {
          if (currentInput.trim()) {
            cmdHistory.push(currentInput);
            historyIdx = -1;
          }
          const toExec = currentInput;
          currentInput = '';
          executeCommandLine(term, toExec);
          return;
        }

        // Backspace
        if (data === '\x7f' || data === '\b') {
          if (currentInput.length > 0) {
            currentInput = currentInput.slice(0, -1);
            term.write('\b \b');
          }
          return;
        }

        // Ctrl+C (Interrupt)
        if (data === '\x03') {
          currentInput = '';
          term.writeln('^C');
          term.write(getPrompt());
          return;
        }

        // Ctrl+L (Clear)
        if (data === '\x0c') {
          term.write('\x1b[2J\x1b[3J\x1b[H');
          term.write(getPrompt() + currentInput);
          return;
        }

        // Ctrl+U (Clear line)
        if (data === '\x15') {
          while (currentInput.length > 0) {
            currentInput = currentInput.slice(0, -1);
            term.write('\b \b');
          }
          return;
        }

        // Up Arrow (History Back)
        if (data === '\x1b[A') {
          if (cmdHistory.length > 0) {
            if (historyIdx === -1) historyIdx = cmdHistory.length - 1;
            else if (historyIdx > 0) historyIdx--;
            
            // clear current line
            while (currentInput.length > 0) {
              currentInput = currentInput.slice(0, -1);
              term.write('\b \b');
            }
            currentInput = cmdHistory[historyIdx] || '';
            term.write(currentInput);
          }
          return;
        }

        // Down Arrow (History Forward)
        if (data === '\x1b[B') {
          if (cmdHistory.length > 0 && historyIdx !== -1) {
            historyIdx++;
            if (historyIdx >= cmdHistory.length) {
              historyIdx = -1;
              while (currentInput.length > 0) {
                currentInput = currentInput.slice(0, -1);
                term.write('\b \b');
              }
            } else {
              while (currentInput.length > 0) {
                currentInput = currentInput.slice(0, -1);
                term.write('\b \b');
              }
              currentInput = cmdHistory[historyIdx] || '';
              term.write(currentInput);
            }
          }
          return;
        }

        // Tab Completion
        if (data === '\t') {
          const builtins = ['pacman', 'ls', 'cd', 'pwd', 'cat', 'mkdir', 'rm', 'touch', 'cp', 'mv', 'open', 'gui', 'neofetch', 'task', 'help', 'uname', 'whoami', 'clear', 'python', 'node', 'gcc'];
          const parts = currentInput.split(/\s+/);
          const last = parts[parts.length - 1] || '';
          if (last) {
            const match = builtins.find(b => b.startsWith(last));
            if (match) {
              const diff = match.slice(last.length);
              currentInput += diff;
              term.write(diff);
            }
          }
          return;
        }

        // Printable text
        if (data >= ' ' || data === '\t') {
          currentInput += data;
          term.write(data);
        }
      });

      // Window resize listener
      const handleResize = () => {
        try {
          fitAddon.fit();
        } catch (_) {}
      };
      window.addEventListener('resize', handleResize);

      // Native Clipboard Paste Handler
      const container = terminalRef.current;
      const handlePaste = (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData('text');
        if (text) {
          e.preventDefault();
          const lines = text.split(/\r?\n/);
          if (lines.length === 1) {
            currentInput += lines[0];
            term.write(lines[0]);
          } else {
            // Multiline script paste: execute line by line
            for (let i = 0; i < lines.length; i++) {
              const l = lines[i];
              if (i === lines.length - 1 && !text.endsWith('\n')) {
                currentInput += l;
                term.write(l);
              } else {
                term.writeln(l);
                executeCommandLine(term, currentInput + l);
                currentInput = '';
              }
            }
          }
        }
      };

      container?.addEventListener('paste', handlePaste);

      return () => {
        window.removeEventListener('resize', handleResize);
        container?.removeEventListener('paste', handlePaste);
      };
    }

    initXterm();

    return () => {
      isCancelled = true;
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
        xtermInstance.current = null;
      }
    };
  }, [user.username, company.id, company.name, hostname]);

  // Handle explicit paste button
  const handlePasteClick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && xtermInstance.current) {
        const term = xtermInstance.current;
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          term.writeln(line);
          await executeCommandLine(term, line);
        }
      }
    } catch {
      alert('To paste, please use keyboard shortcut (Cmd+V on Mac or Ctrl+V on Windows/Linux).');
    }
  };

  // Reset terminal
  const handleResetTerminal = () => {
    if (xtermInstance.current) {
      const term = xtermInstance.current;
      term.write('\x1b[2J\x1b[3J\x1b[H');
      term.writeln('\x1b[1;36m[Session Reset: Arch Linux x86_64]\x1b[0m\r\n');
      term.write(getPrompt(cwd, isRoot));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0d14] text-slate-100 font-mono text-xs select-text overflow-hidden">
      
      {/* Top Header: Arch Linux OS Status Bar */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2 flex flex-wrap items-center justify-between shrink-0 select-none z-10 gap-2">
        <div className="flex items-center space-x-3">
          {/* macOS Window Controls */}
          <div className="flex items-center space-x-1.5">
            <button 
              onClick={handleResetTerminal} 
              className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 transition" 
              title="Reset Terminal Session" 
            />
            <button 
              onClick={() => fitAddonRef.current?.fit()} 
              className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 transition" 
              title="Fit Display" 
            />
            <button 
              className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 transition" 
              title="Arch Linux Active" 
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-bold text-white tracking-tight">Arch Linux (x86_64)</span>
            <span className="hidden sm:inline bg-cyan-950/80 text-cyan-300 text-[11px] px-2 py-0.5 rounded border border-cyan-500/20 font-sans">
              pacman &bull; bash &bull; xterm.js
            </span>
            <span className="hidden md:inline bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded border border-white/10 font-sans">
              {isRoot ? 'root' : user.username}@{hostname}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-sans">
          {/* Paste from Outside Shortcut */}
          <button
            onClick={handlePasteClick}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 transition"
            title="Paste text/script from clipboard into terminal"
          >
            <Clipboard className="w-3.5 h-3.5 text-cyan-400" />
            <span>Paste (Cmd+V)</span>
          </button>

          {/* Nautilus GUI */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('assets', cwd)}
              className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-white/10 transition"
              title="Open /workspace in Nautilus File System GUI"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Nautilus GUI</span>
            </button>
          )}

          {/* Clear Terminal */}
          <button
            onClick={handleResetTerminal}
            className="p-1.5 hover:text-white rounded hover:bg-slate-800 border border-transparent hover:border-white/10 transition"
            title="Clear Terminal Output"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Native xterm.js Terminal Container */}
      <div 
        ref={terminalRef} 
        className="flex-1 w-full h-full bg-[#0a0d14] p-3 overflow-hidden select-text"
        style={{ minHeight: '300px' }}
      />

      {/* Terminal Footer Bar */}
      <div className="bg-[#12161f] border-t border-white/10 px-4 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-sans shrink-0 gap-2">
        <div className="flex items-center space-x-3">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-cyan-400 mr-1.5" />
            Kernel: <strong className="text-white ml-1 font-mono">Linux 6.10.8-arch</strong>
          </span>
          <span className="hidden sm:inline text-slate-400">
            &bull; Engine: <strong className="text-cyan-300 font-mono">xterm.js Canvas &bull; Full Clipboard IO</strong>
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400 overflow-x-auto py-0.5">
          <span className="text-slate-500 font-sans hidden md:inline">Arch Commands:</span>
          <button 
            onClick={() => executeCommandLine(xtermInstance.current, 'pacman -Syu')}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-white/5 text-cyan-300 transition"
          >
            pacman -Syu
          </button>
          <button 
            onClick={() => executeCommandLine(xtermInstance.current, 'neofetch')}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-white/5 text-slate-300 transition"
          >
            neofetch
          </button>
          <button 
            onClick={() => executeCommandLine(xtermInstance.current, 'ls -la /workspace')}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-white/5 text-slate-300 transition"
          >
            ls -la
          </button>
          <button 
            onClick={() => executeCommandLine(xtermInstance.current, 'task')}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-white/5 text-slate-300 transition"
          >
            task
          </button>
          <button 
            onClick={() => executeCommandLine(xtermInstance.current, 'gui')}
            className="px-1.5 py-0.5 bg-indigo-900/40 hover:bg-indigo-800/60 rounded border border-indigo-500/20 text-indigo-300 transition"
          >
            gui
          </button>
        </div>
      </div>

    </div>
  );
};
