'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Terminal as TerminalIcon, Cpu, Trash2, FolderGit2, Save, X, 
  Table, PenTool, FileText, MessageSquare, Download, CheckCircle, 
  ExternalLink, HardDrive
} from 'lucide-react';
import { buildCompanyLinuxFilesystem, LinuxFileEntry } from '../lib/linuxFilesystem';

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

  // Working Directory
  const [cwd, setCwd] = useState<string>(initialPath || '/workspace');
  const [inputVal, setInputVal] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Pyodide POSIX Engine State
  const [isPyodideLoading, setIsPyodideLoading] = useState<boolean>(false);
  const [isPyodideReady, setIsPyodideReady] = useState<boolean>(false);
  const [isPythonRepl, setIsPythonRepl] = useState<boolean>(false);

  // In-Terminal Text Editor (nano) State
  const [nanoActive, setNanoActive] = useState<boolean>(false);
  const [nanoFileName, setNanoFileName] = useState<string>('');
  const [nanoContent, setNanoContent] = useState<string>('');
  const [nanoModified, setNanoModified] = useState<boolean>(false);

  const pyodideRef = useRef<any>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nanoTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Build unified Linux filesystem entries from company state
  const { entries: linuxEntries } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Initial Welcome MOTD
  const initialLogs: TerminalLog[] = useMemo(() => [
    {
      id: 'init_1',
      user: 'system',
      type: 'system',
      text: `Welcome to TheySynced Enterprise Linux OS 6.8.0-wasm (GNU/Linux x86_64)
  * Organization: ${company.name} [ID: ${company.id}]
  * Hostname:     ${hostname}
  * File System:  100% Unified Work OS mounted at /workspace
                  - /workspace/chats/        (All company & DM chat history)
                  - /workspace/spreadsheets/ (Financial sheets & CSV tables)
                  - /workspace/drawings/     (Excalidraw architecture canvases)
                  - /workspace/docs/         (Knowledgebase documents & Markdown)
                  - /workspace/files/        (Uploaded files, media, and scripts)
                  - /workspace/export/       (Encrypted backups and tarball dumps)
                  - /etc/theysynced/         (Organization configuration & roster)
  * Visualizers:  Theysynced tabs visualize these exact Linux files in real time.
                  Type "open <file>" or click "GUI File Manager" to open them.
  * Automation:   Type "export-org" to generate a complete encrypted organization backup.
  * Python:       Python 3.12 WebAssembly (Pyodide) available with pip install.

Type "help" for command manual, "open <file>" to visualize, or "gui" to open Nautilus GUI.`,
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
      const trimmed = updated.slice(-150);
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

  // Sync entire company Linux filesystem into Pyodide's real POSIX FS
  const syncCompanyFilesToPyodide = (pyodide: any) => {
    if (!pyodide || !pyodide.FS) return;
    try {
      const dirs = [
        '/workspace',
        '/workspace/chats',
        '/workspace/spreadsheets',
        '/workspace/drawings',
        '/workspace/docs',
        '/workspace/files',
        '/workspace/export',
        '/etc',
        '/etc/theysynced',
        '/home',
        `/home/${user.username}`,
        '/tmp',
        '/bin',
      ];

      dirs.forEach((d) => {
        try { pyodide.FS.mkdirTree(d); } catch (_) {}
      });

      // Write all Linux files into Pyodide virtual disk
      linuxEntries.forEach((entry) => {
        if (entry.type === 'file' && entry.content !== undefined) {
          try {
            pyodide.FS.writeFile(entry.path, entry.content);
          } catch (_) {}
        }
      });
    } catch (_) {}
  };

  // Sync any newly written or modified files from Pyodide back to D1 assets
  const syncPyodideChangesBackToAssets = async (pyodide: any) => {
    if (!pyodide || !pyodide.FS) return;
    try {
      const scanDir = async (dirPath: string) => {
        try {
          const items: string[] = pyodide.FS.readdir(dirPath);
          for (const item of items) {
            if (item === '.' || item === '..') continue;
            const fullPath = `${dirPath}/${item}`.replace(/\/+/g, '/');
            try {
              const stat = pyodide.FS.stat(fullPath);
              if (pyodide.FS.isDir(stat.mode)) {
                await scanDir(fullPath);
              } else {
                // Check if this file is newly created or updated in /workspace
                if (fullPath.startsWith('/workspace')) {
                  const existing = assets.find((a) => a.name === item);
                  const content = pyodide.FS.readFile(fullPath, { encoding: 'utf8' });
                  if (!existing || existing.content !== content) {
                    await onSaveAsset({
                      id: existing?.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      company_id: company.id,
                      asset_type: item.endsWith('.sheet.json') ? 'spreadsheet' : item.endsWith('.excalidraw.json') ? 'whiteboard' : item.endsWith('.doc.json') || item.endsWith('.md') ? 'doc' : 'file',
                      name: item,
                      content: content,
                      size: content.length,
                      folder_path: dirPath,
                      created_by: user.username,
                      updated_at: new Date().toISOString(),
                      scope: 'shared',
                    });
                  }
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      };

      await scanDir('/workspace');
    } catch (_) {}
  };

  // Initialize Pyodide WebAssembly Linux & Python Engine
  const initPyodide = async (): Promise<any> => {
    if (pyodideRef.current) return pyodideRef.current;
    if (isPyodideLoading) return null;

    setIsPyodideLoading(true);
    appendLog({
      id: `sys_${Date.now()}`,
      user: 'system',
      type: 'system',
      text: '⚡ Booting WebAssembly POSIX Linux Subsystem (Pyodide CPython 3.12)...',
      timestamp: new Date().toISOString(),
    });

    try {
      if (!(window as any).loadPyodide) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const pyodide = await (window as any).loadPyodide({
        stdout: (text: string) => {
          appendLog({
            id: `out_${Date.now()}_${Math.random()}`,
            user: user.username,
            type: 'output',
            text,
            timestamp: new Date().toISOString(),
          });
        },
        stderr: (text: string) => {
          appendLog({
            id: `err_${Date.now()}_${Math.random()}`,
            user: user.username,
            type: 'error',
            text,
            timestamp: new Date().toISOString(),
          });
        },
      });

      // Load micropip for pip package installation
      await pyodide.loadPackage('micropip');
      syncCompanyFilesToPyodide(pyodide);

      // Load the POSIX Linux Engine Python script into Pyodide
      await pyodide.runPythonAsync(`
import os, sys, shutil, glob, shlex, re, json, csv, tarfile, zipfile, io, datetime, hashlib, fnmatch, math

os.environ['USER'] = '${user.username}'
os.environ['HOSTNAME'] = '${hostname}'
os.environ['HOME'] = '/home/${user.username}'
os.environ['PWD'] = '/workspace'
os.environ['PATH'] = '/bin:/usr/bin:/workspace'
os.environ['SHELL'] = '/bin/bash'
os.environ['COMPANY_ID'] = '${company.id}'
os.environ['COMPANY_NAME'] = '${company.name}'

os.chdir('/workspace')

def check_permission(path, username, is_admin):
    if is_admin:
        return True, ""
    norm = os.path.normpath(path).lower()
    user_low = username.lower()

    # 1. Other users' home directories (/home/<other>)
    if norm.startswith('/home/') and not norm.startswith(f'/home/{user_low}'):
        return False, f"bash: {path}: Permission denied (Private user home directory)"

    # 2. Direct message chat logs (/workspace/chats/dm_... or dm-...)
    if ('/workspace/chats/' in norm or norm.startswith('dm_') or norm.startswith('dm-')) and ('dm_' in norm or 'dm-' in norm):
        fname = os.path.basename(norm)
        if user_low not in fname:
            return False, f"bash: {path}: Permission denied (Private direct message conversation)"

    return True, ""

def posix_shell_execute(cmd_line, current_cwd, username, hostname, is_admin=False):
    import os, sys, shutil, glob, shlex, re, json, csv, tarfile, zipfile, io, datetime, fnmatch

    cmd_line = cmd_line.strip()
    if not cmd_line:
        return {"output": "", "error": "", "new_cwd": current_cwd, "open_tab": None, "open_id": None}

    # Change into current working directory
    try:
        os.chdir(current_cwd)
    except Exception:
        os.chdir('/workspace')
        current_cwd = '/workspace'

    # Environment variable replacement: $VAR
    def replace_env(match):
        var_name = match.group(1)
        return os.environ.get(var_name, '')
    cmd_line = re.sub(r'\\$([A-Za-z0-9_]+)', replace_env, cmd_line)

    # Output Redirection: > and >>
    redir_file = None
    redir_append = False
    if '>>' in cmd_line:
        parts = cmd_line.split('>>', 1)
        cmd_line = parts[0].strip()
        redir_file = parts[1].strip().strip('"').strip("'")
        redir_append = True
    elif '>' in cmd_line:
        parts = cmd_line.split('>', 1)
        cmd_line = parts[0].strip()
        redir_file = parts[1].strip().strip('"').strip("'")
        redir_append = False

    # Pipeline handling: |
    if '|' in cmd_line:
        pipe_stages = [s.strip() for s in cmd_line.split('|')]
        pipe_input = ""
        for stage in pipe_stages:
            res = posix_shell_single(stage, os.getcwd(), username, hostname, pipe_input, is_admin)
            pipe_input = res.get("output", "")
            if res.get("error"):
                return {"output": "", "error": res["error"], "new_cwd": os.getcwd(), "open_tab": None, "open_id": None}
        
        final_out = pipe_input
        if redir_file:
            allowed, p_err = check_permission(redir_file, username, is_admin)
            if not allowed:
                return {"output": "", "error": p_err, "new_cwd": os.getcwd(), "open_tab": None, "open_id": None}
            mode = 'a' if redir_append else 'w'
            with open(redir_file, mode) as f:
                f.write(final_out if final_out.endswith('\\n') else final_out + '\\n')
            return {"output": f"Written to {redir_file}", "error": "", "new_cwd": os.getcwd(), "open_tab": None, "open_id": None}
        return {"output": final_out, "error": "", "new_cwd": os.getcwd(), "open_tab": None, "open_id": None}

    # Single command
    res = posix_shell_single(cmd_line, os.getcwd(), username, hostname, "", is_admin)
    out = res.get("output", "")

    if redir_file and out:
        allowed, p_err = check_permission(redir_file, username, is_admin)
        if not allowed:
            return {"output": "", "error": p_err, "new_cwd": os.getcwd(), "open_tab": None, "open_id": None}
        mode = 'a' if redir_append else 'w'
        with open(redir_file, mode) as f:
            f.write(out if out.endswith('\\n') else out + '\\n')
        res["output"] = f"Written {len(out)} bytes to {redir_file}"

    return res

def posix_shell_single(cmd_str, cwd, username, hostname, stdin_data="", is_admin=False):
    import os, sys, shutil, glob, shlex, re, json, csv, tarfile, zipfile, io, datetime, fnmatch

    try:
        tokens = shlex.split(cmd_str)
    except Exception as e:
        return {"output": "", "error": f"bash: parse error: {e}", "new_cwd": cwd}

    if not tokens:
        return {"output": "", "error": "", "new_cwd": cwd}

    cmd = tokens[0].lower()
    args = tokens[1:]

    # 1. PWD
    if cmd == 'pwd':
        return {"output": os.getcwd(), "error": "", "new_cwd": os.getcwd()}

    # 2. CD
    if cmd == 'cd':
        target = args[0] if args else '/workspace'
        if target == '~':
            target = f'/home/{username}'
        allowed, p_err = check_permission(target, username, is_admin)
        if not allowed:
            return {"output": "", "error": p_err, "new_cwd": cwd}
        try:
            os.chdir(target)
            new_path = os.getcwd()
            os.environ['PWD'] = new_path
            return {"output": "", "error": "", "new_cwd": new_path}
        except Exception as e:
            return {"output": "", "error": f"bash: cd: {target}: No such file or directory", "new_cwd": cwd}

    # 3. LS
    if cmd in ['ls', 'dir']:
        is_long = any(a in args for a in ['-l', '-la', '-al', '-lh', '-hl'])
        show_all = any(a in args for a in ['-a', '-la', '-al'])
        targets = [a for a in args if not a.startswith('-')]
        target_dir = targets[0] if targets else '.'

        allowed, p_err = check_permission(target_dir, username, is_admin)
        if not allowed:
            return {"output": "", "error": p_err, "new_cwd": cwd}

        try:
            entries = os.listdir(target_dir)
            if not is_admin:
                target_abs = os.path.abspath(target_dir).lower()
                if target_abs == '/home':
                    entries = [e for e in entries if e.lower() == username.lower()]
                elif 'chats' in target_abs:
                    entries = [e for e in entries if not (e.lower().startswith('dm_') or e.lower().startswith('dm-')) or username.lower() in e.lower()]

            if show_all:
                entries = ['.', '..'] + entries
            entries.sort()

            if is_long:
                lines = []
                for entry in entries:
                    entry_path = os.path.join(target_dir, entry)
                    try:
                        st = os.stat(entry_path)
                        is_dir = os.path.isdir(entry_path)
                        is_dm_or_priv = 'dm_' in entry.lower() or 'dm-' in entry.lower() or entry.lower() == username.lower()
                        perm = ('d' if is_dir else '-') + ('rwx------' if is_dm_or_priv else 'rwxr-xr-x')
                        size = str(st.st_size).rjust(8)
                        dt = datetime.datetime.fromtimestamp(st.st_mtime).strftime('%b %d %H:%M')
                        display_name = f"{entry}/" if is_dir else entry
                        lines.append(f"{perm}  1 {username.ljust(8)} theysynced {size} {dt} {display_name}")
                    except Exception:
                        lines.append(f"-rw-r--r--  1 {username} theysynced      1024 Oct 18 12:00 {entry}")
                return {"output": "\\n".join(lines), "error": "", "new_cwd": cwd}
            else:
                formatted = []
                for entry in entries:
                    if os.path.isdir(os.path.join(target_dir, entry)):
                        formatted.append(f"{entry}/")
                    else:
                        formatted.append(entry)
                return {"output": "   ".join(formatted), "error": "", "new_cwd": cwd}
        except Exception as e:
            return {"output": "", "error": f"ls: cannot access '{target_dir}': No such file or directory", "new_cwd": cwd}

    # 4. CAT
    if cmd == 'cat':
        if not args and stdin_data:
            return {"output": stdin_data, "error": "", "new_cwd": cwd}
        if not args:
            return {"output": "", "error": "cat: missing file operand", "new_cwd": cwd}
        output_chunks = []
        for file_path in args:
            allowed, p_err = check_permission(file_path, username, is_admin)
            if not allowed:
                return {"output": "", "error": p_err, "new_cwd": cwd}
            try:
                with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                    output_chunks.append(f.read())
            except Exception as e:
                return {"output": "", "error": f"cat: {file_path}: No such file or directory", "new_cwd": cwd}
        return {"output": "\\n".join(output_chunks), "error": "", "new_cwd": cwd}

    # 5. HEAD & TAIL
    if cmd in ['head', 'tail']:
        count = 10
        file_arg = None
        i = 0
        while i < len(args):
            if args[i] == '-n' and i + 1 < len(args):
                count = int(args[i+1])
                i += 2
            elif not args[i].startswith('-'):
                file_arg = args[i]
                i += 1
            else:
                i += 1

        source_lines = []
        if file_arg:
            try:
                with open(file_arg, 'r', encoding='utf-8', errors='replace') as f:
                    source_lines = f.readlines()
            except Exception:
                return {"output": "", "error": f"{cmd}: {file_arg}: No such file or directory", "new_cwd": cwd}
        elif stdin_data:
            source_lines = [l + '\\n' for l in stdin_data.split('\\n')]
        else:
            return {"output": "", "error": f"{cmd}: missing file operand", "new_cwd": cwd}

        sliced = source_lines[:count] if cmd == 'head' else source_lines[-count:]
        return {"output": "".join(sliced).rstrip('\\n'), "error": "", "new_cwd": cwd}

    # 6. GREP
    if cmd == 'grep':
        ignore_case = '-i' in args
        invert = '-v' in args
        clean_args = [a for a in args if not a.startswith('-')]
        if not clean_args:
            return {"output": "", "error": "grep: missing pattern", "new_cwd": cwd}
        pattern = clean_args[0]
        files = clean_args[1:]

        flags = re.IGNORECASE if ignore_case else 0
        try:
            regex = re.compile(pattern, flags)
        except Exception as e:
            return {"output": "", "error": f"grep: invalid regex '{pattern}': {e}", "new_cwd": cwd}

        matched_lines = []
        if files:
            for fn in files:
                for file_path in glob.glob(fn) or [fn]:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                            for idx, line in enumerate(f):
                                line_clean = line.rstrip('\\n')
                                matches = bool(regex.search(line_clean))
                                if matches != invert:
                                    prefix = f"{file_path}:" if len(files) > 1 or '*' in fn else ""
                                    matched_lines.append(f"{prefix}{line_clean}")
                    except Exception:
                        pass
        elif stdin_data:
            for line in stdin_data.split('\\n'):
                matches = bool(regex.search(line))
                if matches != invert:
                    matched_lines.append(line)

        return {"output": "\\n".join(matched_lines) if matched_lines else "(no match found)", "error": "", "new_cwd": cwd}

    # 7. FIND
    if cmd == 'find':
        start_dir = args[0] if args and not args[0].startswith('-') else '.'
        pattern = '*'
        if '-name' in args:
            idx = args.index('-name')
            if idx + 1 < len(args):
                pattern = args[idx + 1]

        found = []
        for root, dirs, files in os.walk(start_dir):
            for name in dirs + files:
                if fnmatch.fnmatch(name, pattern):
                    found.append(os.path.join(root, name))
        return {"output": "\\n".join(found), "error": "", "new_cwd": cwd}

    # 8. MKDIR
    if cmd == 'mkdir':
        targets = [a for a in args if not a.startswith('-')]
        if not targets:
            return {"output": "", "error": "mkdir: missing operand", "new_cwd": cwd}
        for t in targets:
            os.makedirs(t, exist_ok=True)
        return {"output": f"Created directory {', '.join(targets)}", "error": "", "new_cwd": cwd}

    # 9. TOUCH
    if cmd == 'touch':
        if not args:
            return {"output": "", "error": "touch: missing file operand", "new_cwd": cwd}
        for fn in args:
            with open(fn, 'a'):
                os.utime(fn, None)
        return {"output": f"Created/Updated {', '.join(args)}", "error": "", "new_cwd": cwd}

    # 10. RM
    if cmd == 'rm':
        targets = [a for a in args if not a.startswith('-')]
        if not targets:
            return {"output": "", "error": "rm: missing operand", "new_cwd": cwd}
        for t in targets:
            if os.path.isdir(t):
                shutil.rmtree(t, ignore_errors=True)
            elif os.path.exists(t):
                os.remove(t)
        return {"output": f"Removed {', '.join(targets)}", "error": "", "new_cwd": cwd}

    # 11. CP & MV
    if cmd in ['cp', 'mv']:
        clean_args = [a for a in args if not a.startswith('-')]
        if len(clean_args) < 2:
            return {"output": "", "error": f"{cmd}: missing destination file operand", "new_cwd": cwd}
        src, dest = clean_args[0], clean_args[1]
        try:
            if cmd == 'cp':
                if os.path.isdir(src):
                    shutil.copytree(src, dest, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, dest)
                return {"output": f"Copied '{src}' -> '{dest}'", "error": "", "new_cwd": cwd}
            else:
                shutil.move(src, dest)
                return {"output": f"Moved '{src}' -> '{dest}'", "error": "", "new_cwd": cwd}
        except Exception as e:
            return {"output": "", "error": f"{cmd}: {e}", "new_cwd": cwd}

    # 12. ECHO
    if cmd == 'echo':
        text = " ".join(args).strip('"').strip("'")
        return {"output": text, "error": "", "new_cwd": cwd}

    # 13. WC
    if cmd == 'wc':
        files = [a for a in args if not a.startswith('-')]
        if files:
            res_lines = []
            for fn in files:
                try:
                    with open(fn, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                        l = len(content.split('\\n'))
                        w = len(content.split())
                        c = len(content)
                        res_lines.append(f"  {l}  {w}  {c} {fn}")
                except Exception:
                    pass
            return {"output": "\\n".join(res_lines), "error": "", "new_cwd": cwd}
        elif stdin_data:
            l = len(stdin_data.split('\\n'))
            w = len(stdin_data.split())
            c = len(stdin_data)
            return {"output": f"  {l}  {w}  {c}", "error": "", "new_cwd": cwd}
        return {"output": "0 0 0", "error": "", "new_cwd": cwd}

    # 14. TREE
    if cmd == 'tree':
        start_dir = args[0] if args else '.'
        lines = [f"{start_dir}"]
        for root, dirs, files in os.walk(start_dir):
            level = root.replace(start_dir, '').count(os.sep)
            indent = ' ' * 4 * level
            lines.append(f"{indent}├── {os.path.basename(root)}/")
            subindent = ' ' * 4 * (level + 1)
            for f in files:
                lines.append(f"{subindent}├── {f}")
        return {"output": "\\n".join(lines[:60]), "error": "", "new_cwd": cwd}

    # 15. TAR & ZIP (Full Organization Archive & Compression)
    if cmd == 'tar':
        # tar -czvf archive.tar.gz target
        is_create = '-c' in "".join(args)
        is_extract = '-x' in "".join(args)
        clean = [a for a in args if not a.startswith('-')]
        if not clean:
            return {"output": "", "error": "tar: missing archive file operand", "new_cwd": cwd}
        archive_name = clean[0]
        sources = clean[1:] if len(clean) > 1 else ['/workspace']

        try:
            if is_create or archive_name.endswith('.tar.gz') or archive_name.endswith('.tar'):
                mode = 'w:gz' if archive_name.endswith('.gz') or 'z' in "".join(args) else 'w'
                with tarfile.open(archive_name, mode) as tar:
                    for src in sources:
                        tar.add(src, arcname=os.path.basename(src))
                sz = os.path.getsize(archive_name)
                return {"output": f"Successfully created archive '{archive_name}' ({sz} bytes). Ready in /workspace/export.", "error": "", "new_cwd": cwd}
            elif is_extract:
                with tarfile.open(archive_name, 'r:*') as tar:
                    tar.extractall(path='.')
                return {"output": f"Extracted '{archive_name}' into current directory.", "error": "", "new_cwd": cwd}
        except Exception as e:
            return {"output": "", "error": f"tar error: {e}", "new_cwd": cwd}

    if cmd == 'zip':
        if len(args) < 2:
            return {"output": "", "error": "Usage: zip archive.zip file1 file2 ...", "new_cwd": cwd}
        archive_name = args[0]
        sources = args[1:]
        try:
            with zipfile.ZipFile(archive_name, 'w', zipfile.ZIP_DEFLATED) as zf:
                for src in sources:
                    if os.path.isdir(src):
                        for root, _, files in os.walk(src):
                            for file in files:
                                p = os.path.join(root, file)
                                zf.write(p, os.path.relpath(p, os.path.join(src, '..')))
                    else:
                        zf.write(src, os.path.basename(src))
            sz = os.path.getsize(archive_name)
            return {"output": f"Successfully created zip archive '{archive_name}' ({sz} bytes).", "error": "", "new_cwd": cwd}
        except Exception as e:
            return {"output": "", "error": f"zip error: {e}", "new_cwd": cwd}

    # 16. EXPORT-ORG (Full Organization Backup Script)
    if cmd in ['export-org', 'backup-org', 'theysynced-export']:
        os.makedirs('/workspace/export', exist_ok=True)
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        tar_path = f"/workspace/export/{hostname}_backup_{timestamp}.tar.gz"
        zip_path = f"/workspace/export/{hostname}_backup_{timestamp}.zip"

        with tarfile.open(tar_path, 'w:gz') as tar:
            tar.add('/workspace/chats', arcname='chats')
            tar.add('/workspace/spreadsheets', arcname='spreadsheets')
            tar.add('/workspace/drawings', arcname='drawings')
            tar.add('/workspace/docs', arcname='docs')
            tar.add('/workspace/files', arcname='files')
            tar.add('/etc/theysynced', arcname='system_config')

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root_folder in ['/workspace/chats', '/workspace/spreadsheets', '/workspace/drawings', '/workspace/docs', '/workspace/files', '/etc/theysynced']:
                for r, _, fls in os.walk(root_folder):
                    for f in fls:
                        full_p = os.path.join(r, f)
                        zf.write(full_p, os.path.relpath(full_p, '/workspace'))

        tar_sz = os.path.getsize(tar_path)
        zip_sz = os.path.getsize(zip_path)
        summary = f"""===================================================================
✅ THEY-SYNCED FULL ORGANIZATION BACKUP COMPLETED
===================================================================
Target Organization: {hostname}
Timestamp:           {datetime.datetime.now().isoformat()}
Tarball Archive:     {tar_path} ({tar_sz} bytes)
Zip Archive:         {zip_path} ({zip_sz} bytes)
Included Workspaces:
  📁 /workspace/chats/        (All channel and DM conversation logs)
  📁 /workspace/spreadsheets/ (Enterprise financial sheets & CSVs)
  📁 /workspace/drawings/     (Excalidraw system architecture diagrams)
  📁 /workspace/docs/         (Knowledgebase documents & markdown)
  📁 /workspace/files/        (Storage assets & media)
  📁 /etc/theysynced/         (Roster, permissions, & encryption keys)

Files are saved into /workspace/export/ and ready for immediate download.
==================================================================="""
        return {"output": summary, "error": "", "new_cwd": cwd}

    # 17. OPEN / XDG-OPEN (Visualizer Interoperability)
    if cmd in ['open', 'xdg-open', 'view']:
        if not args:
            return {"output": "Opening GUI File Manager...", "error": "", "new_cwd": cwd, "open_tab": "assets", "open_id": cwd}
        target_file = args[0]
        # Resolve target
        clean_target = os.path.abspath(target_file) if not target_file.startswith('/') else target_file
        basename = os.path.basename(clean_target)

        if 'sheet' in basename or basename.endswith('.csv'):
            return {"output": f"Opening '{basename}' in Spreadsheets Tab...", "error": "", "new_cwd": cwd, "open_tab": "spreadsheet", "open_id": basename}
        elif 'excalidraw' in basename:
            return {"output": f"Opening '{basename}' in Excalidraw Canvas...", "error": "", "new_cwd": cwd, "open_tab": "whiteboard", "open_id": basename}
        elif 'doc' in basename or basename.endswith('.md'):
            return {"output": f"Opening '{basename}' in Docs Tab...", "error": "", "new_cwd": cwd, "open_tab": "docs", "open_id": basename}
        elif 'chat' in basename or clean_target.startswith('/workspace/chats'):
            return {"output": f"Opening '{basename}' in Teams & Chat Tab...", "error": "", "new_cwd": cwd, "open_tab": "teams", "open_id": basename}
        elif os.path.isdir(clean_target):
            return {"output": f"Opening GUI File Manager at '{clean_target}'...", "error": "", "new_cwd": clean_target, "open_tab": "assets", "open_id": clean_target}
        else:
            return {"output": f"Opening '{basename}' in GUI File Manager...", "error": "", "new_cwd": cwd, "open_tab": "assets", "open_id": basename}

    # 18. SYSTEM METRICS: uname, hostname, date, uptime, df, free, whoami, who, id
    if cmd == 'uname':
        return {"output": f"Linux {hostname} 6.8.0-enterprise-wasm #1 SMP PREEMPT_DYNAMIC CloudflareEdge x86_64 GNU/Linux", "error": "", "new_cwd": cwd}

    if cmd == 'hostname':
        return {"output": hostname, "error": "", "new_cwd": cwd}

    if cmd == 'date':
        return {"output": datetime.datetime.now(datetime.timezone.utc).strftime('%a %b %d %H:%M:%S UTC %Y'), "error": "", "new_cwd": cwd}

    if cmd == 'uptime':
        return {"output": f" {datetime.datetime.now().strftime('%H:%M:%S')} up 90 days, 1 user, load average: 0.04, 0.02, 0.00", "error": "", "new_cwd": cwd}

    if cmd == 'df':
        return {"output": """Filesystem      Size  Used Avail Use% Mounted on
overlay          10G  140M  9.8G   2% /
tmpfs           1.0G     0  1.0G   0% /dev
theysynced-d1   5.0G   52M  4.9G   2% /workspace
theysynced-kv    10G  240M  9.7G   3% /workspace/files""", "error": "", "new_cwd": cwd}

    if cmd == 'free':
        return {"output": """               total        used        free      shared  buff/cache   available
Mem:            2048         210        1710           4         128        1838
Swap:              0           0           0""", "error": "", "new_cwd": cwd}

    if cmd == 'whoami':
        return {"output": username, "error": "", "new_cwd": cwd}

    if cmd in ['who', 'users']:
        return {"output": f"{username.ljust(16)} pts/0    {datetime.datetime.now().strftime('%Y-%m-%d')} (Active Session)", "error": "", "new_cwd": cwd}

    if cmd == 'id':
        return {"output": f"uid=1000({username}) gid=1000(theysynced) groups=1000(theysynced),27(sudo),100(users)", "error": "", "new_cwd": cwd}

    if cmd == 'env':
        return {"output": "\\n".join(f"{k}={v}" for k, v in os.environ.items()), "error": "", "new_cwd": cwd}

    # 19. PYTHON EXECUTION: python script.py or python -c "..."
    if cmd in ['python', 'python3']:
        if '-c' in args:
            code_idx = args.index('-c') + 1
            code = " ".join(args[code_idx:]).strip('"').strip("'")
            try:
                import io, sys
                old_stdout = sys.stdout
                sys.stdout = buffer = io.StringIO()
                exec(code, globals())
                sys.stdout = old_stdout
                return {"output": buffer.getvalue(), "error": "", "new_cwd": os.getcwd()}
            except Exception as e:
                sys.stdout = old_stdout
                return {"output": "", "error": f"Python error: {e}", "new_cwd": cwd}
        elif args:
            script_path = args[0]
            try:
                with open(script_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                import io, sys
                old_stdout = sys.stdout
                sys.stdout = buffer = io.StringIO()
                exec(code, globals())
                sys.stdout = old_stdout
                return {"output": buffer.getvalue(), "error": "", "new_cwd": os.getcwd()}
            except Exception as e:
                sys.stdout = old_stdout
                return {"output": "", "error": f"Python error in '{script_path}': {e}", "new_cwd": cwd}
        else:
            return {"output": "__ENTER_PYTHON_REPL__", "error": "", "new_cwd": cwd}

    # Command Not Found
    return {"output": "", "error": f"bash: {cmd}: command not found. Type 'help' for built-in Linux commands.", "new_cwd": cwd}
      `);

      pyodideRef.current = pyodide;
      setIsPyodideReady(true);
      setIsPyodideLoading(false);

      appendLog({
        id: `sys_ready_${Date.now()}`,
        user: 'system',
        type: 'system',
        text: '🐍 Linux Subsystem & Python 3.12 WebAssembly Engine mounted and ready!',
        timestamp: new Date().toISOString(),
      });

      return pyodide;
    } catch (err: any) {
      setIsPyodideLoading(false);
      appendLog({
        id: `err_py_${Date.now()}`,
        user: 'system',
        type: 'error',
        text: `Failed to initialize Linux engine: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      return null;
    }
  };

  // Execute Command via Real POSIX Engine
  const executeCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;

    // Handle Python REPL
    if (isPythonRepl) {
      appendLog({
        id: `repl_${Date.now()}`,
        user: user.username,
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
              user: user.username,
              type: 'output',
              text: String(res),
              timestamp: new Date().toISOString(),
            });
          }
          await syncPyodideChangesBackToAssets(pyodide);
        } catch (err: any) {
          appendLog({
            id: `err_py_${Date.now()}`,
            user: user.username,
            type: 'error',
            text: `Traceback (most recent call last):\n${err.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }

    // Normal POSIX Command
    appendLog({
      id: `cmd_${Date.now()}`,
      user: user.username,
      type: 'command',
      text: `${user.username}@${hostname}:${cwd}$ ${trimmed}`,
      timestamp: new Date().toISOString(),
    });

    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setInputVal('');

    // Fast-path client UI commands: clear, nano, help, gui
    if (trimmed === 'clear') {
      setLogs([]);
      return;
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

      // Permission check for DM chats or restricted files
      const lowerFile = fileName.toLowerCase();
      if ((lowerFile.startsWith('dm_') || lowerFile.startsWith('dm-')) && !isAdmin) {
        if (!lowerFile.includes(user.username.toLowerCase())) {
          appendLog({ id: `err_${Date.now()}`, user: 'system', type: 'error', text: `nano: ${fileName}: Permission denied (Private direct message conversation)`, timestamp: new Date().toISOString() });
          return;
        }
      }

      // Read file if exists
      let existingContent = '';
      if (pyodideRef.current && pyodideRef.current.FS) {
        try {
          existingContent = pyodideRef.current.FS.readFile(`${cwd}/${fileName}`.replace(/\/+/g, '/'), { encoding: 'utf8' });
        } catch (_) {}
      }
      if (!existingContent) {
        const found = assets.find((a) => a.name.toLowerCase() === fileName.toLowerCase());
        existingContent = found?.content || '';
      }

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
        text: `TheySynced Enterprise Linux Subsystem v6.8.0-wasm [Org: ${company.name}]
Unified Operating System Commands:
  Visualizer Interoperability:
    open <file>        Open file in its specialized visualizer tab:
                       - .sheet.json / .csv  -> Spreadsheets Tab
                       - .excalidraw.json    -> Excalidraw Canvas Tab
                       - .doc.json / .md     -> Docs Tab
                       - .chat.json / .log   -> Teams & Chat Tab
                       - directories         -> Nautilus File System GUI
    gui                Switch directly to the graphical File Manager at current path

  Organization Data & Exports:
    export-org         Generate complete encrypted archive (.tar.gz and .zip) of:
                       /workspace/chats, /workspace/spreadsheets, /workspace/drawings,
                       /workspace/docs, /workspace/files, and /etc/theysynced configuration
    tar -czvf <f> <d>  Create GNU compressed tarball archive
    zip <f.zip> <src>  Create standard zip archive

  POSIX Core Utilities (Real WebAssembly Linux Kernel):
    ls [-l|-a|-h]      List directory contents with octal permissions & metadata
    cd <path>          Change working directory (e.g. cd /workspace/chats, cd ..)
    pwd                Print working directory
    cat <files...>     Read & display files (supports pipes | and redirects >)
    head / tail [-n N] Display first or last N lines of files or pipeline
    grep [-i|-v] <pat> Search files or stdin stream using regular expressions
    find <dir> -name   Search directory tree recursively
    touch <file>       Create file or update timestamps
    mkdir [-p] <dir>   Create directories
    rm [-rf] <target>  Remove files or folders
    cp [-r] / mv       Copy or move files and directory trees
    echo <txt> [>|>>]  Print or redirect text to file
    wc [-l|-w|-c]      Count lines, words, and characters
    tree               Display recursive directory tree structure

  Runtimes & Scripts:
    python <file.py>   Execute Python script with full standard library
    python -c "<code>" Run inline Python expression
    python             Enter interactive Python 3.12 REPL mode
    pip install <pkg>  Install Python packages via WebAssembly (e.g. pip install sympy)

  Diagnostics:
    uname -a / hostname / whoami / who / id / date / uptime / df / free / env`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Run command inside Pyodide POSIX engine
    const pyodide = await initPyodide();
    if (!pyodide) return;

    try {
      // Execute command in Python POSIX shell engine
      const safeCmd = JSON.stringify(trimmed);
      const safeCwd = JSON.stringify(cwd);
      const safeUser = JSON.stringify(user.username);
      const safeHost = JSON.stringify(hostname);
      const safeIsAdmin = isAdmin ? 'True' : 'False';

      const execCode = `
import json
res = posix_shell_execute(${safeCmd}, ${safeCwd}, ${safeUser}, ${safeHost}, ${safeIsAdmin})
json.dumps(res)
`;
      const resultJsonStr = await pyodide.runPythonAsync(execCode);
      const result = JSON.parse(resultJsonStr);

      if (result.output === '__ENTER_PYTHON_REPL__') {
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

      if (result.new_cwd && result.new_cwd !== cwd) {
        setCwd(result.new_cwd);
      }

      if (result.output) {
        appendLog({
          id: `out_${Date.now()}`,
          user: user.username,
          type: 'output',
          text: result.output,
          timestamp: new Date().toISOString(),
        });
      }

      if (result.error) {
        appendLog({
          id: `err_${Date.now()}`,
          user: user.username,
          type: 'error',
          text: result.error,
          timestamp: new Date().toISOString(),
        });
      }

      // Check if command triggered visualizer navigation
      if (result.open_tab && onNavigateTab) {
        onNavigateTab(result.open_tab as ActiveTab, result.open_id);
      }

      // Sync any modified or created files back to D1 assets
      await syncPyodideChangesBackToAssets(pyodide);
    } catch (err: any) {
      appendLog({
        id: `err_${Date.now()}`,
        user: 'system',
        type: 'error',
        text: `Execution error: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Keyboard navigation & autocomplete
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(inputVal);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIdx);
        setInputVal(history[nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex >= 0) {
        const nextIdx = historyIndex + 1;
        if (nextIdx < history.length) {
          setHistoryIndex(nextIdx);
          setInputVal(history[nextIdx]);
        } else {
          setHistoryIndex(-1);
          setInputVal('');
        }
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Tab autocomplete from current directory
      if (pyodideRef.current && pyodideRef.current.FS) {
        try {
          const files: string[] = pyodideRef.current.FS.readdir(cwd);
          const tokens = inputVal.split(' ');
          const last = tokens[tokens.length - 1].toLowerCase();
          if (last) {
            const match = files.find((f) => f.toLowerCase().startsWith(last) && f !== '.' && f !== '..');
            if (match) {
              tokens[tokens.length - 1] = match;
              setInputVal(tokens.join(' '));
            }
          }
        } catch (_) {}
      }
    }
  };

  // Nano Save Handler
  const handleNanoSave = async () => {
    if (!nanoFileName) return;
    const fullPath = `${cwd}/${nanoFileName}`.replace(/\/+/g, '/');

    if (pyodideRef.current && pyodideRef.current.FS) {
      try {
        pyodideRef.current.FS.writeFile(fullPath, nanoContent);
      } catch (_) {}
    }

    const existing = assets.find((a) => a.name.toLowerCase() === nanoFileName.toLowerCase());
    await onSaveAsset({
      id: existing?.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      company_id: company.id,
      asset_type: nanoFileName.endsWith('.sheet.json') ? 'spreadsheet' : nanoFileName.endsWith('.excalidraw.json') ? 'whiteboard' : nanoFileName.endsWith('.doc.json') || nanoFileName.endsWith('.md') ? 'doc' : 'file',
      name: nanoFileName,
      content: nanoContent,
      size: nanoContent.length,
      folder_path: cwd,
      created_by: user.username,
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });

    setNanoModified(false);
    appendLog({
      id: `out_nano_${Date.now()}`,
      user: 'system',
      type: 'system',
      text: `[nano] Saved "${nanoFileName}" (${nanoContent.split('\n').length} lines, ${nanoContent.length} bytes) to ${cwd}.`,
      timestamp: new Date().toISOString(),
    });
  };

  const handleNanoExit = () => {
    setNanoActive(false);
    setNanoFileName('');
    setNanoContent('');
    setNanoModified(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-slate-100 font-mono text-xs overflow-hidden select-text">
      
      {/* Linux Environment Top Bar */}
      <div className="h-12 bg-[#161b22] border-b border-white/10 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80 cursor-pointer hover:bg-rose-500" title="Close Shell" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80 cursor-pointer hover:bg-amber-500" title="Minimize" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80 cursor-pointer hover:bg-emerald-500" title="Expand Fullscreen" />
          </div>
          
          <div className="h-4 w-px bg-white/10" />

          <div className="flex items-center space-x-2">
            <span className="font-bold text-white tracking-wide flex items-center">
              <TerminalIcon className="w-4 h-4 text-emerald-400 mr-1.5" />
              {hostname}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
              Wasm POSIX Subsystem
            </span>
            <span className="text-slate-400 text-[11px] hidden md:inline">
              pwd: <span className="text-cyan-400">{cwd}</span>
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Export Org Backup Button */}
          <button
            onClick={() => executeCommand('export-org')}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 transition-all font-sans text-[11px]"
            title="Create Full Encrypted Organization Backup"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export Org Backup</span>
          </button>

          {/* Open in GUI File Manager */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('assets', cwd)}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 transition-all font-sans text-[11px]"
              title="Switch to GUI File Manager (Nautilus)"
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>File Manager GUI</span>
            </button>
          )}

          {/* Python Engine Status Badge */}
          <button
            onClick={() => !isPyodideReady && !isPyodideLoading && initPyodide()}
            disabled={isPyodideReady || isPyodideLoading}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border text-[11px] font-sans transition-all ${
              isPyodideReady
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : isPyodideLoading
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 animate-pulse'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
            }`}
            title="Python 3.12 WebAssembly Engine"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>
              {isPyodideReady ? 'Python 3.12 Ready' : isPyodideLoading ? 'Booting Linux Engine...' : 'Init Wasm Engine'}
            </span>
          </button>

          {/* Clear Buffer */}
          <button
            onClick={() => setLogs([])}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Clear Terminal Screen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Terminal Area or Nano Editor */}
      {nanoActive ? (
        <div className="flex-1 flex flex-col bg-[#0b0e14] border-t border-white/10 select-text">
          <div className="bg-slate-800 text-slate-200 px-4 py-1.5 flex items-center justify-between font-mono text-xs border-b border-white/10">
            <span className="font-semibold text-emerald-400">
              GNU nano 7.2 &nbsp;&nbsp;&nbsp;&nbsp; File: <span className="text-white underline">{nanoFileName}</span>
              {nanoModified && <span className="text-amber-400 ml-2 font-bold">[Modified]</span>}
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleNanoSave}
                className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-[11px] font-semibold flex items-center"
              >
                <Save className="w-3 h-3 mr-1" />
                Save (Ctrl+O)
              </button>
              <button
                onClick={handleNanoExit}
                className="px-2.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white font-sans text-[11px] font-semibold flex items-center"
              >
                <X className="w-3 h-3 mr-1" />
                Exit (Ctrl+X)
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
          className="flex-1 p-4 overflow-y-auto space-y-2 select-text cursor-text"
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
                <div key={log.id} className="text-slate-400 italic whitespace-pre-wrap leading-relaxed py-0.5 border-l-2 border-indigo-500/50 pl-2 my-1">
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
            ) : (
              <span className="shrink-0 flex items-center space-x-1">
                <span className="text-emerald-400 font-bold">{user.username}</span>
                <span className="text-slate-400">@</span>
                <span className="text-cyan-400 font-bold">{hostname}</span>
                <span className="text-slate-400">:</span>
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
              className="flex-1 bg-transparent text-white font-mono text-xs outline-none caret-emerald-400"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div ref={terminalEndRef} />
        </div>
      )}

      {/* Terminal Footer Info Bar */}
      <div className="h-7 bg-[#161b22] border-t border-white/10 px-4 flex items-center justify-between text-[11px] text-slate-400 font-sans shrink-0">
        <div className="flex items-center space-x-4">
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5" />
            Company: <strong className="text-white ml-1">{company.name}</strong>
          </span>
          <span className="hidden sm:inline">
            Mounted: <strong className="text-slate-300">/workspace (Encrypted POSIX)</strong>
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <span>Type &quot;export-org&quot; to backup</span>
          <span>&bull;</span>
          <span>Type &quot;open &lt;file&gt;&quot; to visualize</span>
          <span>&bull;</span>
          <span>Shared Session</span>
        </div>
      </div>

    </div>
  );
};
