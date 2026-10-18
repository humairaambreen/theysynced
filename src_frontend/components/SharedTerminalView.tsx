'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { Terminal as TerminalIcon, RotateCcw, Copy, Check } from 'lucide-react';
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

interface VfsNode {
  content: string;
  isDir: boolean;
  mode: string;
  owner: string;
  size: number;
  mtime: Date;
}

// Pure POSIX path resolver with .. and . normalization
function resolvePath(currentCwd: string, targetPath: string, homeDir: string): string {
  if (!targetPath || targetPath === '~') return homeDir;
  if (targetPath === '/') return '/';
  if (targetPath.startsWith('~/')) {
    return resolvePath(homeDir, targetPath.slice(2), homeDir);
  }

  const absolute = targetPath.startsWith('/') 
    ? targetPath 
    : `${currentCwd === '/' ? '' : currentCwd}/${targetPath}`;

  const segments = absolute.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  return '/' + resolved.join('/');
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

  const homeDir = `/home/${user.username}`;
  const cwdRef = useRef<string>(homeDir);
  const isRootRef = useRef<boolean>(false);
  const isFishShellRef = useRef<boolean>(false);
  const isPythonReplRef = useRef<boolean>(false);

  const installedPkgsRef = useRef<Set<string>>(
    new Set(['base', 'linux', 'bash', 'coreutils', 'pacman', 'curl', 'grep', 'sed', 'nano'])
  );

  const cmdHistoryRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const vfsRef = useRef<Map<string, VfsNode>>(new Map());

  const hostname = useMemo(() => {
    const slug = (company.name || 'theysynced')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'theysynced';
    return `arch-${slug}`;
  }, [company.name]);

  // Unified company filesystem entries
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Initialize and populate standard Linux Filesystem (FHS)
  useEffect(() => {
    const vfs = new Map<string, VfsNode>();
    const now = new Date();

    const addDir = (path: string, owner = 'root', mode = 'drwxr-xr-x') => {
      vfs.set(path, { content: '', isDir: true, mode, owner, size: 4096, mtime: now });
    };

    const addFile = (path: string, content: string, owner = 'root', mode = '-rw-r--r--') => {
      vfs.set(path, { content, isDir: false, mode, owner, size: content.length, mtime: now });
    };

    // Standard Linux FHS directories
    ['/', '/bin', '/sbin', '/usr', '/usr/bin', '/usr/sbin', '/etc', '/var', '/tmp', '/home', homeDir].forEach(d => addDir(d));

    // Protected /workspace mount point with company assets
    addDir('/workspace', 'root', 'drwxr-xr-x');
    ['chats', 'spreadsheets', 'drawings', 'docs', 'tasks', 'files', 'export'].forEach(sd => {
      addDir(`/workspace/${sd}`, user.username, 'drwxrwxr-x');
    });

    // Populate standard Linux binaries
    const binaries = [
      'bash', 'sh', 'ls', 'cat', 'touch', 'mkdir', 'rm', 'cp', 'mv', 
      'pwd', 'echo', 'grep', 'whoami', 'id', 'date', 'uname', 'neofetch', 
      'clear', 'ps', 'kill', 'nano', 'python3', 'python', 'node', 'git', 
      'curl', 'find', 'which', 'env', 'export', 'chmod', 'pacman', 'gui', 'open'
    ];
    binaries.forEach(b => {
      addFile(`/bin/${b}`, `#!/bin/sh\n`, 'root', '-rwxr-xr-x');
      addFile(`/usr/bin/${b}`, `#!/bin/sh\n`, 'root', '-rwxr-xr-x');
    });

    // Standard /etc configs
    addFile('/etc/os-release', `NAME="Arch Linux"\nPRETTY_NAME="Arch Linux x86_64"\nID=arch\n`);
    addFile('/etc/hostname', `${hostname}\n`);

    // Populate user home directory
    addDir(homeDir, user.username, 'drwx------');
    addFile(`${homeDir}/.bashrc`, `export PS1='[\\u@\\h \\W]\\$ '\nalias ls='ls --color=auto'\n`, user.username);
    addFile(`${homeDir}/README.md`, `# TheySynced Arch Linux\nCompany files live in /workspace.\n`, user.username);

    // Mount live company entries
    for (const e of linuxEntries) {
      if (e.type === 'folder') {
        addDir(e.path, user.username, e.mode || 'drwxrwxr-x');
      } else {
        addFile(e.path, e.content || '', user.username, e.mode || '-rw-rw-r--');
      }
    }

    vfsRef.current = vfs;
  }, [linuxEntries, user.username, hostname, homeDir]);

  // Prompt generator
  const getPrompt = () => {
    if (isPythonReplRef.current) {
      return '>>> ';
    }

    if (isFishShellRef.current) {
      let displayDir = cwdRef.current;
      if (displayDir === homeDir) displayDir = '~';
      else if (displayDir.startsWith(homeDir + '/')) displayDir = '~' + displayDir.slice(homeDir.length);
      return `\x1b[1;36m${user.username}\x1b[0m@\x1b[1;35m${hostname}\x1b[0m \x1b[1;34m${displayDir}\x1b[0m\x1b[1;32m > \x1b[0m`;
    }

    const userPart = isRootRef.current 
      ? `\x1b[1;31mroot\x1b[0m@\x1b[1;36m${hostname}\x1b[0m` 
      : `\x1b[1;32m${user.username}\x1b[0m@\x1b[1;36m${hostname}\x1b[0m`;

    let displayDir = cwdRef.current;
    if (displayDir === homeDir) displayDir = '~';
    else if (displayDir.startsWith(homeDir + '/')) displayDir = '~' + displayDir.slice(homeDir.length);

    const pathPart = `\x1b[1;34m${displayDir}\x1b[0m`;
    const symbol = isRootRef.current ? `\x1b[1;31m#\x1b[0m ` : `\x1b[1;33m$\x1b[0m `;
    return `[${userPart} ${pathPart}]${symbol}`;
  };

  // Neofetch render
  const renderNeofetch = () => {
    return `\x1b[1;36m                   -\`                    \x1b[1;32m${user.username}\x1b[0m@\x1b[1;36m${hostname}\x1b[0m
\x1b[1;36m                  .o+\`                   \x1b[0;37m--------------------\x1b[0m
\x1b[1;36m                 \`ooo/                   \x1b[1;37mOS:\x1b[0m Arch Linux x86_64
\x1b[1;36m                \`+oooo:                  \x1b[1;37mHost:\x1b[0m TheySynced Workstation
\x1b[1;36m               \`+oooooo:                 \x1b[1;37mKernel:\x1b[0m 6.10.8-arch1-1
\x1b[1;36m               -+oooooo+:                \x1b[1;37mUptime:\x1b[0m 6 hours, 18 mins
\x1b[1;36m             \`/:-:++oooo+:               \x1b[1;37mPackages:\x1b[0m ${installedPkgsRef.current.size + 214} (pacman)
\x1b[1;36m            \`/++++/+++++++:              \x1b[1;37mShell:\x1b[0m ${isFishShellRef.current ? 'fish 3.7.1' : 'bash 5.2.32'}
\x1b[1;36m           \`/++++++++++++++:             \x1b[1;37mTerminal:\x1b[0m xterm.js Canvas
\x1b[1;36m          \`/+++ooooooooooooo/\`           \x1b[1;37mMemory:\x1b[0m 1420MiB / 8192MiB
\x1b[1;36m         ./ooosssso++osssssso+\`          \x1b[1;37mWorkspace:\x1b[0m /workspace (All files mounted)
\x1b[1;36m        .oossssso-\`\`\`\`/ossssss+\`         
\x1b[1;36m       -osssssso.      :ssssssso.        
\x1b[1;36m      :osssssss/        osssso+++.       
\x1b[1;36m     /ossssssss/        +ssssooo/-       
\x1b[1;36m   \`/ossssso+/:-        -:/+osssso+-     
\x1b[1;36m  \`+sso+:-\`                 \`.-/+oso:    
\x1b[1;36m \`++:.                           \`-/+/   
\x1b[1;36m .\`                                 \`/   \x1b[0m`;
  };

  // Perform directory listing
  const performLs = (term: any, targetArg?: string, showAll = false, showLong = false) => {
    const vfs = vfsRef.current;
    const targetDir = targetArg 
      ? resolvePath(cwdRef.current, targetArg, homeDir) 
      : cwdRef.current;

    const targetNode = vfs.get(targetDir);
    if (!targetNode) {
      term.writeln(`ls: cannot access '${targetArg || ''}': No such file or directory`);
      return;
    }

    if (!targetNode.isDir) {
      term.writeln(targetDir.split('/').pop() || targetDir);
      return;
    }

    const normDir = targetDir === '/' ? '/' : targetDir.replace(/\/+$/, '');
    const entries: { name: string; isDir: boolean; mode: string; size: number; mtime: Date; owner: string }[] = [];

    if (showAll) {
      entries.push({ name: '.', isDir: true, mode: 'drwxr-xr-x', size: 4096, mtime: targetNode.mtime, owner: targetNode.owner });
      entries.push({ name: '..', isDir: true, mode: 'drwxr-xr-x', size: 4096, mtime: targetNode.mtime, owner: 'root' });
    }

    for (const [p, n] of vfs.entries()) {
      if (p === normDir || p === '/') continue;

      const lastSlash = p.lastIndexOf('/');
      const parent = lastSlash === 0 ? '/' : p.substring(0, lastSlash);
      const base = p.substring(lastSlash + 1);

      if (parent === normDir && base) {
        if (!showAll && base.startsWith('.')) continue;
        entries.push({ name: base, isDir: n.isDir, mode: n.mode, size: n.size, mtime: n.mtime, owner: n.owner });
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    if (entries.length === 0) {
      term.writeln('\x1b[2m(empty directory)\x1b[0m');
      return;
    }

    if (showLong) {
      term.writeln(`total ${entries.length * 4}`);
      for (const e of entries) {
        const dateStr = e.mtime.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' + 
          e.mtime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const nameFormatted = e.isDir 
          ? `\x1b[1;34m${e.name}/\x1b[0m` 
          : (e.mode.includes('x') ? `\x1b[1;32m${e.name}*\x1b[0m` : `\x1b[0;37m${e.name}\x1b[0m`);
        term.writeln(`${e.mode} 1 ${e.owner} ${e.owner} ${e.size.toString().padStart(6, ' ')} ${dateStr} ${nameFormatted}`);
      }
    } else {
      const formatted = entries.map(e => {
        if (e.isDir) return `\x1b[1;34m${e.name}/\x1b[0m`;
        if (e.mode.includes('x')) return `\x1b[1;32m${e.name}*\x1b[0m`;
        return `\x1b[0;37m${e.name}\x1b[0m`;
      });
      term.writeln(formatted.join('   '));
    }
  };

  // Execute Command Line
  const executeCommandLine = async (term: any, cmdLine: string) => {
    let line = cmdLine.trim();
    if (!line) {
      term.write('\r\n' + getPrompt());
      return;
    }

    term.write('\r\n');

    // Handle Python REPL exit
    if (isPythonReplRef.current) {
      if (line === 'exit()' || line === 'quit()' || line === 'exit') {
        isPythonReplRef.current = false;
        term.writeln('Exiting Python REPL.');
        term.write(getPrompt());
        return;
      }
      try {
        // Safe math/eval execution
        const res = Function(`"use strict"; return (${line})`)();
        if (res !== undefined) term.writeln(String(res));
      } catch (err: any) {
        term.writeln(`Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n${err.message}`);
      }
      term.write(getPrompt());
      return;
    }

    // Handle fish shell exit
    if (isFishShellRef.current && (line === 'exit' || line === 'logout')) {
      isFishShellRef.current = false;
      term.writeln('logout: Switched back to bash.');
      term.write(getPrompt());
      return;
    }

    // Handle clear
    if (line === 'clear' || line === 'cls') {
      term.write('\x1b[2J\x1b[3J\x1b[H');
      term.write(getPrompt());
      return;
    }

    // Handle pwd
    if (line === 'pwd') {
      term.writeln(cwdRef.current);
      term.write(getPrompt());
      return;
    }

    // Handle whoami & id
    if (line === 'whoami') {
      term.writeln(isRootRef.current ? 'root' : user.username);
      term.write(getPrompt());
      return;
    }
    if (line === 'id') {
      term.writeln(isRootRef.current 
        ? 'uid=0(root) gid=0(root) groups=0(root),1(bin),10(wheel)' 
        : `uid=1000(${user.username}) gid=1000(${user.username}) groups=1000(${user.username}),10(wheel),998(theysynced)`);
      term.write(getPrompt());
      return;
    }

    // Handle su / sudo su
    if (line === 'sudo su' || line === 'su' || line === 'su root') {
      isRootRef.current = true;
      term.writeln('\x1b[1;32mSwitched session to superuser (root).\x1b[0m');
      term.write(getPrompt());
      return;
    }
    if (line === 'exit' || line === 'logout') {
      if (isRootRef.current) {
        isRootRef.current = false;
        term.writeln('logout: Switched back to ' + user.username);
        term.write(getPrompt());
        return;
      }
    }

    // Handle uname
    if (line === 'uname' || line.startsWith('uname ')) {
      if (line.includes('-a')) {
        term.writeln(`Linux ${hostname} 6.10.8-arch1-1 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`);
      } else if (line.includes('-r')) {
        term.writeln('6.10.8-arch1-1');
      } else {
        term.writeln('Linux');
      }
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
      term.writeln(renderNeofetch());
      term.write(getPrompt());
      return;
    }

    // Handle cd (Strict POSIX path navigation)
    if (line === 'cd' || line.startsWith('cd ')) {
      const parts = line.split(/\s+/);
      const targetArg = parts[1] || '~';
      const targetResolved = resolvePath(cwdRef.current, targetArg, homeDir);

      const targetNode = vfsRef.current.get(targetResolved);
      if (!targetNode) {
        term.writeln(`-bash: cd: ${targetArg}: No such file or directory`);
      } else if (!targetNode.isDir) {
        term.writeln(`-bash: cd: ${targetArg}: Not a directory`);
      } else {
        cwdRef.current = targetResolved;
      }

      term.write(getPrompt());
      return;
    }

    // Handle ls / dir
    if (line === 'ls' || line.startsWith('ls ') || line === 'dir') {
      const tokens = line.split(/\s+/).slice(1);
      let showAll = false;
      let showLong = false;
      let targetPath: string | undefined = undefined;

      for (const t of tokens) {
        if (t.startsWith('-')) {
          if (t.includes('a')) showAll = true;
          if (t.includes('l')) showLong = true;
        } else if (!targetPath) {
          targetPath = t;
        }
      }

      performLs(term, targetPath, showAll, showLong);
      term.write(getPrompt());
      return;
    }

    // Handle cat
    if (line.startsWith('cat ') || line.startsWith('head ') || line.startsWith('tail ')) {
      const tokens = line.split(/\s+/).slice(1);
      const fileArg = tokens[tokens.length - 1];
      if (!fileArg) {
        term.writeln('cat: missing operand');
      } else {
        const fullPath = resolvePath(cwdRef.current, fileArg, homeDir);
        const fileNode = vfsRef.current.get(fullPath);
        if (!fileNode) {
          term.writeln(`cat: ${fileArg}: No such file or directory`);
        } else if (fileNode.isDir) {
          term.writeln(`cat: ${fileArg}: Is a directory`);
        } else {
          term.writeln(fileNode.content);
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle touch
    if (line.startsWith('touch ')) {
      const fname = line.split(/\s+/)[1];
      if (fname) {
        const fullPath = resolvePath(cwdRef.current, fname, homeDir);
        vfsRef.current.set(fullPath, {
          content: '',
          isDir: false,
          mode: '-rw-r--r--',
          owner: user.username,
          size: 0,
          mtime: new Date(),
        });

        if (fullPath.startsWith('/workspace/')) {
          const name = fullPath.split('/').pop() || fname;
          const folder_path = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/workspace';
          onSaveAsset({
            id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            company_id: company.id,
            asset_type: 'file',
            name,
            folder_path,
            content: '',
            file_type: 'text/plain',
            created_by: user.id,
          });
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle mkdir
    if (line.startsWith('mkdir ')) {
      const parts = line.split(/\s+/).filter(p => !p.startsWith('-'));
      const dname = parts[1];
      if (dname) {
        const fullPath = resolvePath(cwdRef.current, dname, homeDir);
        vfsRef.current.set(fullPath, {
          content: '',
          isDir: true,
          mode: 'drwxr-xr-x',
          owner: user.username,
          size: 4096,
          mtime: new Date(),
        });
      }
      term.write(getPrompt());
      return;
    }

    // Handle rm (Protected mount point guard)
    if (line.startsWith('rm ') || line.startsWith('rmdir ')) {
      const parts = line.split(/\s+/).filter(p => !p.startsWith('-'));
      const targetArg = parts[1];
      if (targetArg) {
        const fullPath = resolvePath(cwdRef.current, targetArg, homeDir);
        if (fullPath === '/' || fullPath === '/workspace') {
          term.writeln(`rm: cannot remove '${targetArg}': Device or resource busy (protected mount point)`);
        } else if (!vfsRef.current.has(fullPath)) {
          term.writeln(`rm: cannot remove '${targetArg}': No such file or directory`);
        } else {
          vfsRef.current.delete(fullPath);
          if (fullPath.startsWith('/workspace/')) {
            const name = fullPath.split('/').pop();
            const assetMatch = assets.find(a => a.name === name || a.name === fullPath);
            if (assetMatch) onDeleteAsset(assetMatch.id);
          }
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle echo
    if (line.startsWith('echo')) {
      const matchRedirect = line.match(/^echo\s+(.*)\s+>\s+(.+)$/);
      if (matchRedirect) {
        const content = matchRedirect[1].replace(/^["']|["']$/g, '');
        const targetFile = matchRedirect[2].trim();
        const fullPath = resolvePath(cwdRef.current, targetFile, homeDir);

        vfsRef.current.set(fullPath, {
          content: content + '\n',
          isDir: false,
          mode: '-rw-r--r--',
          owner: user.username,
          size: content.length + 1,
          mtime: new Date(),
        });

        if (fullPath.startsWith('/workspace/')) {
          const name = fullPath.split('/').pop() || targetFile;
          const folder_path = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/workspace';
          onSaveAsset({
            id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            company_id: company.id,
            asset_type: 'file',
            name,
            folder_path,
            content,
            file_type: 'text/plain',
            created_by: user.id,
          });
        }
      } else {
        const text = line.replace(/^echo\s*/, '').replace(/^["']|["']$/g, '');
        term.writeln(text);
      }
      term.write(getPrompt());
      return;
    }

    // Handle pacman / apt / brew (Dynamic real package installation)
    if (line.startsWith('pacman') || line.startsWith('sudo pacman') || line.startsWith('apt') || line.startsWith('sudo apt') || line.startsWith('brew')) {
      const parts = line.replace(/^sudo\s+/, '').split(/\s+/);
      const op = parts[1] || '';
      const pkg = parts[2] || parts[parts.length - 1] || '';

      if (op === '-Syu' || op === 'update' || op === 'upgrade') {
        term.writeln(':: Synchronizing package databases...');
        term.writeln(' core is up to date');
        term.writeln(' extra is up to date');
        term.writeln(' multilib is up to date');
        term.writeln(':: Starting full system upgrade...');
        term.writeln(' there is nothing to do');
      } else if (op.startsWith('-S') || op === 'install' || (parts[0] === 'brew' && parts[1] === 'install')) {
        const pkgName = pkg.replace(/^-+/, '');
        if (!pkgName || pkgName === 'install') {
          term.writeln('error: no targets specified (use -h for help)');
        } else {
          installedPkgsRef.current.add(pkgName);

          // Add executable into /usr/bin/ and /bin/
          const binPath = `/usr/bin/${pkgName}`;
          vfsRef.current.set(binPath, {
            content: `#!/bin/sh\n# ${pkgName} binary\n`,
            isDir: false,
            mode: '-rwxr-xr-x',
            owner: 'root',
            size: 1024,
            mtime: new Date(),
          });
          vfsRef.current.set(`/bin/${pkgName}`, {
            content: `#!/bin/sh\n# ${pkgName} binary\n`,
            isDir: false,
            mode: '-rwxr-xr-x',
            owner: 'root',
            size: 1024,
            mtime: new Date(),
          });

          term.writeln('resolving dependencies...');
          term.writeln('looking for conflicting packages...');
          term.writeln(`\r\nPackages (1) ${pkgName}-latest-x86_64`);
          term.writeln(`:: Proceed with installation? [Y/n] y`);
          term.writeln(`:: Retrieving packages...`);
          term.writeln(` ${pkgName} [####################################] 100%`);
          term.writeln(`(1/1) checking keys in keyring        [####################################] 100%`);
          term.writeln(`(1/1) checking package integrity      [####################################] 100%`);
          term.writeln(`(1/1) installing ${pkgName}           [####################################] 100%`);
          term.writeln(`\x1b[1;32m✓ ${pkgName} installed successfully into ${binPath}\x1b[0m`);
        }
      } else if (op === '-Q' || op === 'list') {
        term.writeln(Array.from(installedPkgsRef.current).join('  '));
      } else {
        term.writeln(`usage: pacman {-S|-Syu|-Q|-Ss} [package]`);
      }
      term.write(getPrompt());
      return;
    }

    // Handle fish
    if (line === 'fish') {
      isFishShellRef.current = true;
      term.writeln('\x1b[1;32mWelcome to fish, the friendly interactive shell\x1b[0m');
      term.writeln('Type \x1b[1;33mhelp\x1b[0m for instructions, or \x1b[1;33mexit\x1b[0m to return to bash.');
      term.write(getPrompt());
      return;
    }

    // Handle python / python3
    if (line === 'python' || line === 'python3') {
      isPythonReplRef.current = true;
      term.writeln('Python 3.12.0 (main, Oct 18 2026, 12:00:00) [GCC 14.2.0] on linux');
      term.writeln('Type "help", "copyright", "credits" or "license" for more information.');
      term.write(getPrompt());
      return;
    }

    // Handle curl
    if (line.startsWith('curl')) {
      const parts = line.split(/\s+/).filter(p => !p.startsWith('-'));
      const url = parts[1];
      if (url) {
        try {
          term.writeln(`* Trying ${url}...`);
          const res = await fetch(url, { method: 'GET' });
          const txt = await res.text();
          term.writeln(txt.slice(0, 1500) + (txt.length > 1500 ? '\n\x1b[2m...[output truncated]\x1b[0m' : ''));
        } catch (err: any) {
          term.writeln(`curl: (6) Could not resolve host: ${url}`);
        }
      }
      term.write(getPrompt());
      return;
    }

    // Handle open / gui
    if (line.startsWith('open ') || line === 'gui') {
      if (line === 'gui') {
        onNavigateTab?.('assets');
        term.writeln('\x1b[1;32m✓ Switched to Nautilus File System GUI\x1b[0m');
      } else {
        const target = line.split(/\s+/)[1];
        if (target.includes('doc')) onNavigateTab?.('docs');
        else if (target.includes('task')) onNavigateTab?.('tasks');
        else if (target.includes('sheet')) onNavigateTab?.('spreadsheet');
        else if (target.includes('chat')) onNavigateTab?.('teams');
        else onNavigateTab?.('assets');
        term.writeln(`\x1b[1;32m✓ Opened asset in native tab: ${target}\x1b[0m`);
      }
      term.write(getPrompt());
      return;
    }

    // Check if command is an installed binary
    const binaryName = line.split(/\s+/)[0];
    if (vfsRef.current.has(`/bin/${binaryName}`) || vfsRef.current.has(`/usr/bin/${binaryName}`) || installedPkgsRef.current.has(binaryName)) {
      term.writeln(`[${binaryName}: executed successfully]`);
      term.write(getPrompt());
      return;
    }

    term.writeln(`-bash: ${binaryName}: command not found. Install it with 'pacman -S ${binaryName}'.`);
    term.write(getPrompt());
  };

  // Mount xterm.js
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

      // Welcome Banner (Instant 0ms boot)
      term.writeln('\x1b[1;36mTheySynced Arch Linux Work OS \x1b[0;37m(v6.10.8-arch1-1 x86_64)\x1b[0m');
      term.writeln('All company assets mounted at \x1b[1;34m/workspace\x1b[0m. Type \x1b[1;33mneofetch\x1b[0m or \x1b[1;33mpacman -S <pkg>\x1b[0m.\r\n');
      term.write(getPrompt());

      let currentInput = '';

      term.onData((data: string) => {
        // Enter
        if (data === '\r') {
          if (currentInput.trim()) {
            cmdHistoryRef.current.push(currentInput);
            historyIdxRef.current = -1;
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

        // Ctrl+C
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

        // Up Arrow (History back)
        if (data === '\x1b[A') {
          const hist = cmdHistoryRef.current;
          if (hist.length > 0) {
            if (historyIdxRef.current === -1) historyIdxRef.current = hist.length - 1;
            else if (historyIdxRef.current > 0) historyIdxRef.current--;

            while (currentInput.length > 0) {
              currentInput = currentInput.slice(0, -1);
              term.write('\b \b');
            }
            currentInput = hist[historyIdxRef.current] || '';
            term.write(currentInput);
          }
          return;
        }

        // Down Arrow (History forward)
        if (data === '\x1b[B') {
          const hist = cmdHistoryRef.current;
          if (historyIdxRef.current !== -1) {
            if (historyIdxRef.current < hist.length - 1) {
              historyIdxRef.current++;
              while (currentInput.length > 0) {
                currentInput = currentInput.slice(0, -1);
                term.write('\b \b');
              }
              currentInput = hist[historyIdxRef.current] || '';
              term.write(currentInput);
            } else {
              historyIdxRef.current = -1;
              while (currentInput.length > 0) {
                currentInput = currentInput.slice(0, -1);
                term.write('\b \b');
              }
              currentInput = '';
            }
          }
          return;
        }

        // Printable Characters & Outside Pastes (Cmd+V)
        if (data >= ' ' || data === '\t') {
          currentInput += data;
          term.write(data);
        }
      });
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
      if (term) {
        try {
          term.dispose();
        } catch (_) {}
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0a0d14] text-slate-100 font-sans select-none overflow-hidden">
      {/* Minimal Distraction-Free Header (No Bloatware Buttons) */}
      <div className="bg-[#10141d] border-b border-white/10 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
            <TerminalIcon className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-white text-xs tracking-wide">Terminal</span>
          <span className="text-slate-500 text-xs">&bull;</span>
          <span className="text-slate-400 text-xs font-mono">{hostname}</span>
        </div>

        <button
          onClick={() => {
            if (xtermInstance.current) {
              xtermInstance.current.clear();
              xtermInstance.current.write(getPrompt());
            }
          }}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Clear Terminal"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Full-Bleed Terminal Viewport */}
      <div 
        ref={terminalRef} 
        className="flex-1 w-full h-full bg-[#0a0d14] p-3 overflow-hidden select-text"
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};
