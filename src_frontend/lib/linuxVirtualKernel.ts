/**
 * TheySynced Enterprise Virtual POSIX Linux Kernel & Shell Subsystem
 * Complete in-memory virtual filesystem, real permission ACL, sudo/su superuser system,
 * APT (Debian dpkg) & Homebrew (brew) package managers, and command pipeline execution.
 */

import { AVAILABLE_PACKAGES, PackageMeta, resolvePackageName, renderNeofetch, renderHtop } from './linuxPackageEngine';
import { LinuxFileEntry } from './linuxFilesystem';

export interface VNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  content: string;
  size: number;
  mode: string;
  owner: string;
  group: string;
  mtime: Date;
}

export interface ShellExecResult {
  output: string;
  error: string;
  newCwd?: string;
  openTab?: string;
  openId?: string;
  enterPythonRepl?: boolean;
  enterNodeRepl?: boolean;
  switchUser?: string;
  installedPackagesChanged?: string[];
}

export class LinuxVirtualKernel {
  private vfs: Map<string, VNode> = new Map();
  private companyName: string;
  private companyId: string;
  private hostname: string;
  private installedPackages: Set<string>;

  constructor(
    companyName: string,
    companyId: string,
    hostname: string,
    initialPackages: string[] = ['base-files', 'coreutils', 'bash']
  ) {
    this.companyName = companyName;
    this.companyId = companyId;
    this.hostname = hostname;
    this.installedPackages = new Set(initialPackages);
    this.initSystemTree();
  }

  public getInstalledPackages(): string[] {
    return Array.from(this.installedPackages);
  }

  public setInstalledPackages(pkgs: string[]) {
    this.installedPackages = new Set(pkgs);
  }

  /**
   * Initialize standard Linux FHS (Filesystem Hierarchy Standard) directories
   */
  private initSystemTree() {
    const dirs = [
      '/',
      '/bin',
      '/sbin',
      '/usr',
      '/usr/bin',
      '/usr/sbin',
      '/usr/local',
      '/usr/local/bin',
      '/opt',
      '/opt/homebrew',
      '/opt/homebrew/bin',
      '/opt/homebrew/Cellar',
      '/etc',
      '/etc/apt',
      '/etc/apt/sources.list.d',
      '/etc/theysynced',
      '/var',
      '/var/log',
      '/var/lib',
      '/var/lib/dpkg',
      '/var/lib/apt',
      '/var/lib/apt/lists',
      '/tmp',
      '/dev',
      '/proc',
      '/sys',
      '/root',
      '/home',
      '/workspace',
      '/workspace/chats',
      '/workspace/spreadsheets',
      '/workspace/drawings',
      '/workspace/docs',
      '/workspace/files',
      '/workspace/tasks',
      '/workspace/export',
    ];

    dirs.forEach((d) => {
      this.mkdir(d, 'root', '0755');
    });

    // Special permissions
    const rootDir = this.vfs.get('/root');
    if (rootDir) rootDir.mode = 'drwx------';

    // Seed /etc files
    this.writeFile('/etc/hostname', this.hostname + '\n', 'root', '0644');
    this.writeFile(
      '/etc/os-release',
      `NAME="TheySynced Linux Enterprise"
VERSION="6.8.0-wasm"
ID=theysynced
ID_LIKE=debian
PRETTY_NAME="TheySynced Enterprise Linux 6.8.0-wasm (Ubuntu/Debian Subsystem)"
VERSION_ID="2026.04"
HOME_URL="https://theysynced.com"
SUPPORT_URL="https://app.theysynced.workers.dev"
BUG_REPORT_URL="https://github.com/humairaambreen/theysynced"
`,
      'root',
      '0644'
    );

    this.writeFile(
      '/etc/apt/sources.list',
      `# Official TheySynced Enterprise Debian Mirror
deb http://deb.theysynced.org/enterprise jammy main restricted universe multiverse
deb http://deb.theysynced.org/enterprise jammy-updates main restricted universe multiverse
deb http://deb.theysynced.org/enterprise jammy-security main restricted universe multiverse
`,
      'root',
      '0644'
    );

    this.writeFile(
      '/etc/sudoers',
      `# /etc/sudoers - Enterprise privilege specification
Defaults        env_reset
Defaults        mail_badpass
Defaults        secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# User privilege specification
root    ALL=(ALL:ALL) ALL

# Members of the admin group may gain root privileges
%admin  ALL=(ALL) ALL
%sudo   ALL=(ALL:ALL) ALL
`,
      'root',
      '0440'
    );

    this.writeFile(
      '/etc/passwd',
      `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
`,
      'root',
      '0644'
    );
  }

  /**
   * Mount files from company LinuxFilesystem builder into virtual filesystem
   */
  public mountCompanyFiles(entries: LinuxFileEntry[], currentUsername: string) {
    // Ensure home directory for current user
    this.mkdir(`/home/${currentUsername}`, currentUsername, '0700');

    entries.forEach((e) => {
      const cleanPath = e.path.replace(/\/+/g, '/');
      if (e.type === 'folder') {
        this.mkdir(cleanPath, e.created_by || 'system', e.mode || '0755');
      } else {
        this.writeFile(
          cleanPath,
          e.content || '',
          e.created_by || 'system',
          e.mode || '0644'
        );
      }
    });

    // Update dpkg status file
    this.updateDpkgStatus();
  }

  private updateDpkgStatus() {
    let dpkgText = '';
    this.installedPackages.forEach((pkgName) => {
      const meta = AVAILABLE_PACKAGES[pkgName];
      if (meta) {
        dpkgText += `Package: ${meta.name}
Status: install ok installed
Priority: ${meta.priority}
Section: ${meta.section}
Installed-Size: ${meta.installedSize}
Maintainer: ${meta.maintainer}
Architecture: ${meta.architecture}
Version: ${meta.version}
Description: ${meta.description}

`;
      }
    });
    this.writeFile('/var/lib/dpkg/status', dpkgText, 'root', '0644');
  }

  // Filesystem primitives
  public normalizePath(rawPath: string, cwd: string, username: string): string {
    let p = rawPath.trim();
    if (p === '~' || p.startsWith('~/')) {
      p = `/home/${username}` + p.slice(1);
    }
    if (!p.startsWith('/')) {
      p = `${cwd}/${p}`;
    }
    const parts = p.split('/').filter((x) => x && x !== '.');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return '/' + resolved.join('/');
  }

  public mkdir(path: string, owner: string = 'root', mode: string = '0755'): boolean {
    const clean = path.replace(/\/+/g, '/');
    if (this.vfs.has(clean)) return false;
    const name = clean === '/' ? '/' : clean.split('/').pop() || '';
    this.vfs.set(clean, {
      path: clean,
      name,
      type: 'dir',
      content: '',
      size: 4096,
      mode: mode.startsWith('d') ? mode : `d${mode}`,
      owner,
      group: 'theysynced',
      mtime: new Date(),
    });
    return true;
  }

  public writeFile(
    path: string,
    content: string,
    owner: string = 'root',
    mode: string = '0644'
  ): void {
    const clean = path.replace(/\/+/g, '/');
    const name = clean.split('/').pop() || '';
    // Ensure parent directory exists
    const parent = clean.substring(0, clean.lastIndexOf('/')) || '/';
    if (!this.vfs.has(parent)) {
      this.mkdir(parent, owner, '0755');
    }

    this.vfs.set(clean, {
      path: clean,
      name,
      type: 'file',
      content,
      size: new TextEncoder().encode(content).length,
      mode: mode.startsWith('-') ? mode : `-${mode}`,
      owner,
      group: 'theysynced',
      mtime: new Date(),
    });
  }

  public readFile(path: string): string | null {
    const node = this.vfs.get(path.replace(/\/+/g, '/'));
    if (!node || node.type !== 'file') return null;
    return node.content;
  }

  public readdir(path: string): string[] | null {
    const clean = path.replace(/\/+/g, '/');
    const node = this.vfs.get(clean);
    if (!node || node.type !== 'dir') return null;

    const items: string[] = [];
    const prefix = clean === '/' ? '/' : `${clean}/`;
    for (const [p, n] of this.vfs.entries()) {
      if (p !== clean && p.startsWith(prefix)) {
        const rel = p.slice(prefix.length);
        if (!rel.includes('/')) {
          items.push(n.name);
        }
      }
    }
    return items;
  }

  public stat(path: string): VNode | null {
    return this.vfs.get(path.replace(/\/+/g, '/')) || null;
  }

  public unlink(path: string): boolean {
    const clean = path.replace(/\/+/g, '/');
    return this.vfs.delete(clean);
  }

  public rmdir(path: string): boolean {
    const clean = path.replace(/\/+/g, '/');
    // Check if dir has children
    const prefix = clean === '/' ? '/' : `${clean}/`;
    for (const p of this.vfs.keys()) {
      if (p !== clean && p.startsWith(prefix)) return false; // not empty
    }
    return this.vfs.delete(clean);
  }

  /**
   * Permission ACL Enforcement
   * Returns [allowed, errorMessage]
   */
  public checkPermission(
    path: string,
    username: string,
    isRoot: boolean,
    isAdmin: boolean
  ): [boolean, string] {
    if (isRoot) return [true, ''];

    const clean = path.toLowerCase();
    const userLow = username.toLowerCase();

    // 1. Root home directory /root
    if (clean === '/root' || clean.startsWith('/root/')) {
      return [false, `bash: ${path}: Permission denied (Superuser directory)`];
    }

    // 2. Other users' personal homes /home/<other>
    if (clean.startsWith('/home/') && !clean.startsWith(`/home/${userLow}`)) {
      return [false, `bash: ${path}: Permission denied (Private user home directory)`];
    }

    // 3. Direct Message Chat logs
    if (clean.includes('/workspace/chats/')) {
      const fname = clean.split('/').pop() || '';
      if ((fname.startsWith('dm_') || fname.startsWith('dm-')) && !isAdmin) {
        if (!fname.includes(userLow)) {
          return [false, `bash: ${path}: Permission denied (Private direct message conversation)`];
        }
      }
    }

    return [true, ''];
  }

  /**
   * Execute Shell Command Line (with pipes | and redirects >)
   */
  public async executeCommandLine(
    cmdLine: string,
    cwd: string,
    username: string,
    isRoot: boolean,
    isAdmin: boolean
  ): Promise<ShellExecResult> {
    const trimmed = cmdLine.trim();
    if (!trimmed) {
      return { output: '', error: '', newCwd: cwd };
    }

    // Handle Output Redirection: > or >>
    let redirFile: string | null = null;
    let redirAppend = false;
    let execStr = trimmed;

    if (trimmed.includes('>>')) {
      const parts = trimmed.split('>>');
      execStr = parts[0].trim();
      redirFile = parts[1].trim();
      redirAppend = true;
    } else if (trimmed.includes('>')) {
      const parts = trimmed.split('>');
      execStr = parts[0].trim();
      redirFile = parts[1].trim();
      redirAppend = false;
    }

    // Handle Pipeline: cmd1 | cmd2
    if (execStr.includes('|')) {
      const pipeStages = execStr.split('|').map((s) => s.trim());
      let pipeInput = '';
      let lastCwd = cwd;

      for (let i = 0; i < pipeStages.length; i++) {
        const stage = pipeStages[i];
        const res = await this.executeSingle(stage, lastCwd, username, isRoot, isAdmin, pipeInput);
        if (res.error) {
          return { output: '', error: res.error, newCwd: res.newCwd || lastCwd };
        }
        pipeInput = res.output;
        if (res.newCwd) lastCwd = res.newCwd;
      }

      if (redirFile) {
        const targetPath = this.normalizePath(redirFile, lastCwd, username);
        const [allowed, err] = this.checkPermission(targetPath, username, isRoot, isAdmin);
        if (!allowed) return { output: '', error: err, newCwd: lastCwd };

        const prev = redirAppend ? (this.readFile(targetPath) || '') : '';
        const toWrite = prev + (pipeInput.endsWith('\n') ? pipeInput : pipeInput + '\n');
        this.writeFile(targetPath, toWrite, isRoot ? 'root' : username);
        return { output: `Written ${toWrite.length} bytes to ${redirFile}`, error: '', newCwd: lastCwd };
      }

      return { output: pipeInput, error: '', newCwd: lastCwd };
    }

    // Single command execution
    const res = await this.executeSingle(execStr, cwd, username, isRoot, isAdmin, '');

    if (redirFile && res.output) {
      const targetPath = this.normalizePath(redirFile, cwd, username);
      const [allowed, err] = this.checkPermission(targetPath, username, isRoot, isAdmin);
      if (!allowed) return { output: '', error: err, newCwd: res.newCwd || cwd };

      const prev = redirAppend ? (this.readFile(targetPath) || '') : '';
      const toWrite = prev + (res.output.endsWith('\n') ? res.output : res.output + '\n');
      this.writeFile(targetPath, toWrite, isRoot ? 'root' : username);
      res.output = `Written ${toWrite.length} bytes to ${redirFile}`;
    }

    return res;
  }

  /**
   * Execute a single shell command token stream
   */
  private async executeSingle(
    cmdStr: string,
    cwd: string,
    username: string,
    isRoot: boolean,
    isAdmin: boolean,
    stdinData: string
  ): Promise<ShellExecResult> {
    const tokens = this.parseArgs(cmdStr);
    if (tokens.length === 0) {
      return { output: '', error: '', newCwd: cwd };
    }

    let cmd = tokens[0];
    let args = tokens.slice(1);
    let effectiveIsRoot = isRoot;

    // Sudo Handling
    if (cmd === 'sudo') {
      if (!isAdmin) {
        return {
          output: '',
          error: `${username} is not in the sudoers file. This incident will be reported.`,
          newCwd: cwd,
        };
      }
      if (args.length === 0 || args[0] === 'su' || args[0] === '-s' || args[0] === 'bash') {
        return {
          output: `Switched to root superuser environment. Full privileges enabled.\nType 'exit' to return to ${username}.`,
          error: '',
          newCwd: cwd,
          switchUser: 'root',
        };
      }
      effectiveIsRoot = true;
      cmd = args[0];
      args = args.slice(1);
    }

    // SU handling
    if (cmd === 'su') {
      const target = args[0] || 'root';
      if (target === 'root') {
        if (!isAdmin) {
          return {
            output: '',
            error: `su: Authentication failure (Admin privilege required for root escalation)`,
            newCwd: cwd,
          };
        }
        return {
          output: `Switched to root superuser session.\nType 'exit' to logout.`,
          error: '',
          newCwd: cwd,
          switchUser: 'root',
        };
      } else if (target === username) {
        return {
          output: `Logged back in as ${username}.`,
          error: '',
          newCwd: cwd,
          switchUser: username,
        };
      }
    }

    const effectiveUser = effectiveIsRoot ? 'root' : username;

    // 1. PWD
    if (cmd === 'pwd') {
      return { output: cwd, error: '', newCwd: cwd };
    }

    // 2. CD
    if (cmd === 'cd') {
      const target = args[0] ? this.normalizePath(args[0], cwd, effectiveUser) : '/workspace';
      const [allowed, pErr] = this.checkPermission(target, effectiveUser, effectiveIsRoot, isAdmin);
      if (!allowed) return { output: '', error: pErr, newCwd: cwd };

      const node = this.stat(target);
      if (!node || node.type !== 'dir') {
        return { output: '', error: `bash: cd: ${args[0] || target}: No such file or directory`, newCwd: cwd };
      }
      return { output: '', error: '', newCwd: target };
    }

    // 3. LS / DIR
    if (cmd === 'ls' || cmd === 'dir') {
      const isLong = args.some((a) => ['-l', '-la', '-al', '-lh', '-hl'].includes(a));
      const showAll = args.some((a) => ['-a', '-la', '-al'].includes(a));
      const targetArg = args.find((a) => !a.startsWith('-')) || '.';
      const targetDir = this.normalizePath(targetArg, cwd, effectiveUser);

      const [allowed, pErr] = this.checkPermission(targetDir, effectiveUser, effectiveIsRoot, isAdmin);
      if (!allowed) return { output: '', error: pErr, newCwd: cwd };

      const entries = this.readdir(targetDir);
      if (entries === null) {
        return { output: '', error: `ls: cannot access '${targetArg}': No such file or directory`, newCwd: cwd };
      }

      let filtered = [...entries];
      if (!effectiveIsRoot && !isAdmin) {
        if (targetDir === '/home') {
          filtered = filtered.filter((e) => e.toLowerCase() === effectiveUser.toLowerCase());
        } else if (targetDir.includes('/chats')) {
          filtered = filtered.filter((e) => {
            const low = e.toLowerCase();
            if (low.startsWith('dm_') || low.startsWith('dm-')) {
              return low.includes(effectiveUser.toLowerCase());
            }
            return true;
          });
        }
      }

      if (showAll) {
        filtered = ['.', '..', ...filtered];
      }
      filtered.sort();

      if (isLong) {
        const lines: string[] = [];
        filtered.forEach((entry) => {
          if (entry === '.' || entry === '..') {
            lines.push(`drwxr-xr-x  2 ${effectiveUser.padEnd(8)} theysynced     4096 Oct 18 12:00 ${entry}`);
            return;
          }
          const itemPath = `${targetDir}/${entry}`.replace(/\/+/g, '/');
          const node = this.stat(itemPath);
          const isDir = node?.type === 'dir';
          const perm = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
          const size = (node?.size || 1024).toString().padStart(8);
          const dt = node?.mtime ? node.mtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Oct 18 12:00';
          lines.push(`${perm}  1 ${effectiveUser.padEnd(8)} theysynced ${size} ${dt} ${isDir ? entry + '/' : entry}`);
        });
        return { output: lines.join('\n'), error: '', newCwd: cwd };
      } else {
        const formatted = filtered.map((e) => {
          if (e === '.' || e === '..') return e;
          const node = this.stat(`${targetDir}/${e}`.replace(/\/+/g, '/'));
          return node?.type === 'dir' ? `${e}/` : e;
        });
        return { output: formatted.join('   '), error: '', newCwd: cwd };
      }
    }

    // 4. CAT
    if (cmd === 'cat') {
      if (args.length === 0 && stdinData) {
        return { output: stdinData, error: '', newCwd: cwd };
      }
      if (args.length === 0) {
        return { output: '', error: 'cat: missing file operand', newCwd: cwd };
      }
      const outputParts: string[] = [];
      for (const arg of args) {
        const p = this.normalizePath(arg, cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };

        const content = this.readFile(p);
        if (content === null) {
          return { output: '', error: `cat: ${arg}: No such file or directory`, newCwd: cwd };
        }
        outputParts.push(content);
      }
      return { output: outputParts.join('\n'), error: '', newCwd: cwd };
    }

    // 5. HEAD / TAIL
    if (cmd === 'head' || cmd === 'tail') {
      let n = 10;
      let fileArg = args[0];
      if (args[0] === '-n' && args[1]) {
        n = parseInt(args[1], 10) || 10;
        fileArg = args[2];
      }

      let text = stdinData;
      if (fileArg) {
        const p = this.normalizePath(fileArg, cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };
        const content = this.readFile(p);
        if (content === null) return { output: '', error: `${cmd}: ${fileArg}: No such file`, newCwd: cwd };
        text = content;
      }

      const lines = text.split('\n');
      const sliced = cmd === 'head' ? lines.slice(0, n) : lines.slice(-n);
      return { output: sliced.join('\n'), error: '', newCwd: cwd };
    }

    // 6. GREP
    if (cmd === 'grep') {
      const isIgnoreCase = args.includes('-i');
      const isInvert = args.includes('-v');
      const cleanArgs = args.filter((a) => !a.startsWith('-'));
      if (cleanArgs.length === 0) {
        return { output: '', error: 'Usage: grep [-i] [-v] <pattern> [file]', newCwd: cwd };
      }
      const pattern = cleanArgs[0];
      const fileArg = cleanArgs[1];

      let text = stdinData;
      if (fileArg) {
        const p = this.normalizePath(fileArg, cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };
        const content = this.readFile(p);
        if (content === null) return { output: '', error: `grep: ${fileArg}: No such file`, newCwd: cwd };
        text = content;
      }

      const flags = isIgnoreCase ? 'i' : '';
      const regex = new RegExp(pattern, flags);
      const matches = text.split('\n').filter((line) => {
        const hit = regex.test(line);
        return isInvert ? !hit : hit;
      });
      return { output: matches.join('\n'), error: '', newCwd: cwd };
    }

    // 7. ECHO
    if (cmd === 'echo') {
      return { output: args.join(' ').replace(/^["']|["']$/g, ''), error: '', newCwd: cwd };
    }

    // 8. MKDIR
    if (cmd === 'mkdir') {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return { output: '', error: 'mkdir: missing operand', newCwd: cwd };
      const p = this.normalizePath(target, cwd, effectiveUser);
      const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
      if (!allowed) return { output: '', error: pErr, newCwd: cwd };

      this.mkdir(p, effectiveUser);
      return { output: '', error: '', newCwd: cwd };
    }

    // 9. TOUCH
    if (cmd === 'touch') {
      if (args.length === 0) return { output: '', error: 'touch: missing file operand', newCwd: cwd };
      for (const arg of args) {
        const p = this.normalizePath(arg, cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };
        if (!this.stat(p)) {
          this.writeFile(p, '', effectiveUser);
        }
      }
      return { output: '', error: '', newCwd: cwd };
    }

    // 10. RM
    if (cmd === 'rm') {
      const isRecursive = args.some((a) => a.includes('r') || a.includes('R'));
      const targets = args.filter((a) => !a.startsWith('-'));
      if (targets.length === 0) return { output: '', error: 'rm: missing operand', newCwd: cwd };

      for (const t of targets) {
        const p = this.normalizePath(t, cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };

        const node = this.stat(p);
        if (!node) return { output: '', error: `rm: cannot remove '${t}': No such file or directory`, newCwd: cwd };

        if (node.type === 'dir') {
          if (!isRecursive) {
            return { output: '', error: `rm: cannot remove '${t}': Is a directory (use -r)`, newCwd: cwd };
          }
          this.rmdir(p);
        } else {
          this.unlink(p);
        }
      }
      return { output: '', error: '', newCwd: cwd };
    }

    // 11. CP / MV
    if (cmd === 'cp' || cmd === 'mv') {
      const cleanArgs = args.filter((a) => !a.startsWith('-'));
      if (cleanArgs.length < 2) return { output: '', error: `${cmd}: missing destination operand`, newCwd: cwd };
      const src = this.normalizePath(cleanArgs[0], cwd, effectiveUser);
      const dest = this.normalizePath(cleanArgs[1], cwd, effectiveUser);

      const [allowedSrc, pErr1] = this.checkPermission(src, effectiveUser, effectiveIsRoot, isAdmin);
      if (!allowedSrc) return { output: '', error: pErr1, newCwd: cwd };
      const [allowedDest, pErr2] = this.checkPermission(dest, effectiveUser, effectiveIsRoot, isAdmin);
      if (!allowedDest) return { output: '', error: pErr2, newCwd: cwd };

      const content = this.readFile(src);
      if (content === null) return { output: '', error: `${cmd}: cannot stat '${cleanArgs[0]}': No such file`, newCwd: cwd };

      let targetFile = dest;
      const destNode = this.stat(dest);
      if (destNode && destNode.type === 'dir') {
        targetFile = `${dest}/${src.split('/').pop()}`.replace(/\/+/g, '/');
      }

      this.writeFile(targetFile, content, effectiveUser);
      if (cmd === 'mv') this.unlink(src);
      return { output: '', error: '', newCwd: cwd };
    }

    // 12. WC
    if (cmd === 'wc') {
      let text = stdinData;
      if (args.length > 0) {
        const p = this.normalizePath(args[0], cwd, effectiveUser);
        const [allowed, pErr] = this.checkPermission(p, effectiveUser, effectiveIsRoot, isAdmin);
        if (!allowed) return { output: '', error: pErr, newCwd: cwd };
        const content = this.readFile(p);
        if (content === null) return { output: '', error: `wc: ${args[0]}: No such file`, newCwd: cwd };
        text = content;
      }
      const l = text.split('\n').length;
      const w = text.split(/\s+/).filter(Boolean).length;
      const c = new TextEncoder().encode(text).length;
      return { output: `  ${l}  ${w}  ${c} ${args[0] || ''}`, error: '', newCwd: cwd };
    }

    // 13. TREE
    if (cmd === 'tree') {
      const target = args[0] ? this.normalizePath(args[0], cwd, effectiveUser) : cwd;
      const lines = [target];
      const walk = (dir: string, prefix: string) => {
        const entries = this.readdir(dir) || [];
        entries.sort();
        entries.forEach((e, idx) => {
          const isLast = idx === entries.length - 1;
          const full = `${dir}/${e}`.replace(/\/+/g, '/');
          const node = this.stat(full);
          const isDir = node?.type === 'dir';
          lines.push(`${prefix}${isLast ? '└── ' : '├── '}${e}${isDir ? '/' : ''}`);
          if (isDir && lines.length < 50) {
            walk(full, prefix + (isLast ? '    ' : '│   '));
          }
        });
      };
      walk(target, '');
      return { output: lines.slice(0, 60).join('\n'), error: '', newCwd: cwd };
    }

    // ==========================================
    // 14. APT & APT-GET PACKAGE MANAGER
    // ==========================================
    if (cmd === 'apt' || cmd === 'apt-get') {
      const subcmd = args[0]?.toLowerCase();
      const pkgTargets = args.slice(1).filter((a) => !a.startsWith('-'));

      if (subcmd === 'update') {
        if (!effectiveIsRoot) {
          return {
            output: '',
            error: `Reading package lists... Done\nE: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)\n(Try: sudo apt update)`,
            newCwd: cwd,
          };
        }
        return {
          output: `Hit:1 http://deb.theysynced.org/enterprise jammy InRelease
Get:2 http://deb.theysynced.org/enterprise jammy-updates InRelease [119 kB]
Get:3 http://deb.theysynced.org/enterprise jammy-security InRelease [110 kB]
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
All packages are up to date.`,
          error: '',
          newCwd: cwd,
        };
      }

      if (subcmd === 'install') {
        if (!effectiveIsRoot) {
          return {
            output: '',
            error: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock, are you root?\n(Try: sudo apt install ${pkgTargets.join(' ')})`,
            newCwd: cwd,
          };
        }
        if (pkgTargets.length === 0) {
          return { output: '', error: 'apt: missing package operand. Usage: sudo apt install <package>', newCwd: cwd };
        }

        const logLines: string[] = [];
        const nextInstalled = new Set(this.installedPackages);

        for (const t of pkgTargets) {
          const resolved = resolvePackageName(t);
          const meta = AVAILABLE_PACKAGES[resolved];
          if (!meta) {
            logLines.push(`E: Unable to locate package ${t}`);
            continue;
          }
          if (nextInstalled.has(meta.name)) {
            logLines.push(`${meta.name} is already the newest version (${meta.version}).`);
            continue;
          }

          nextInstalled.add(meta.name);
          logLines.push(`Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
The following NEW packages will be installed:
  ${meta.name} ${meta.dependencies.join(' ')}
0 upgraded, ${meta.dependencies.length + 1} newly installed, 0 to remove.
Need to get ${Math.round(meta.installedSize / 4)} kB of archives.
After this operation, ${(meta.installedSize / 1024).toFixed(1)} MB of additional disk space will be used.
Get:1 http://deb.theysynced.org/enterprise jammy/main ${meta.name} ${meta.architecture} [${Math.round(meta.installedSize / 4)} kB]
Fetched ${Math.round(meta.installedSize / 4)} kB in 0.2s
Selecting previously unselected package ${meta.name}.
(Reading database ... 28412 files and directories currently installed.)
Preparing to unpack ${meta.name}_${meta.version}_${meta.architecture}.deb ...
Unpacking ${meta.name} (${meta.version}) ...
Setting up ${meta.name} (${meta.version}) ...
Processing triggers for man-db (2.10.2-1) ...
✨ Successfully installed ${meta.name}. Available binaries: ${meta.binaries.join(', ')}`);
        }

        this.installedPackages = nextInstalled;
        this.updateDpkgStatus();

        return {
          output: logLines.join('\n\n'),
          error: '',
          newCwd: cwd,
          installedPackagesChanged: Array.from(nextInstalled),
        };
      }

      if (subcmd === 'remove' || subcmd === 'purge') {
        if (!effectiveIsRoot) {
          return {
            output: '',
            error: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n(Try: sudo apt remove ${pkgTargets.join(' ')})`,
            newCwd: cwd,
          };
        }

        const logLines: string[] = [];
        const nextInstalled = new Set(this.installedPackages);

        for (const t of pkgTargets) {
          const resolved = resolvePackageName(t);
          if (!nextInstalled.has(resolved)) {
            logLines.push(`Package '${t}' is not installed, so not removed`);
            continue;
          }
          nextInstalled.delete(resolved);
          logLines.push(`Reading package lists... Done
Building dependency tree... Done
The following packages will be REMOVED:
  ${resolved}
0 upgraded, 0 newly installed, 1 to remove.
(Reading database ... 28412 files and directories currently installed.)
Removing ${resolved} ...
Processing triggers for man-db (2.10.2-1) ...`);
        }

        this.installedPackages = nextInstalled;
        this.updateDpkgStatus();

        return {
          output: logLines.join('\n\n'),
          error: '',
          newCwd: cwd,
          installedPackagesChanged: Array.from(nextInstalled),
        };
      }

      if (subcmd === 'list') {
        const isInstalledOnly = args.includes('--installed');
        const listLines: string[] = ['Listing... Done'];
        Object.values(AVAILABLE_PACKAGES).forEach((p) => {
          const isInst = this.installedPackages.has(p.name);
          if (isInstalledOnly && !isInst) return;
          listLines.push(`${p.name}/${p.section} ${p.version} ${p.architecture}${isInst ? ' [installed]' : ''}`);
        });
        return { output: listLines.join('\n'), error: '', newCwd: cwd };
      }

      if (subcmd === 'search') {
        const q = (pkgTargets[0] || '').toLowerCase();
        const results: string[] = ['Sorting... Done', 'Full Text Search... Done'];
        Object.values(AVAILABLE_PACKAGES).forEach((p) => {
          if (p.name.includes(q) || p.description.toLowerCase().includes(q)) {
            const isInst = this.installedPackages.has(p.name);
            results.push(`${p.name}/${p.section} ${p.version} ${p.architecture}${isInst ? ' [installed]' : ''}\n  ${p.description}`);
          }
        });
        return { output: results.join('\n'), error: '', newCwd: cwd };
      }

      if (subcmd === 'show') {
        const resolved = resolvePackageName(pkgTargets[0] || '');
        const p = AVAILABLE_PACKAGES[resolved];
        if (!p) return { output: '', error: `N: Unable to locate package ${pkgTargets[0]}`, newCwd: cwd };
        return {
          output: `Package: ${p.name}
Version: ${p.version}
Priority: ${p.priority}
Section: ${p.section}
Maintainer: ${p.maintainer}
Installed-Size: ${p.installedSize} kB
Depends: ${p.dependencies.join(', ') || 'libc6 (>= 2.34)'}
Homepage: https://theysynced.com
Download-Size: ${Math.round(p.installedSize / 4)} kB
Description: ${p.description}`,
          error: '',
          newCwd: cwd,
        };
      }

      return { output: 'Usage: apt [update|install|remove|list|search|show]', error: '', newCwd: cwd };
    }

    // ==========================================
    // 15. HOMEBREW (brew) PACKAGE MANAGER
    // ==========================================
    if (cmd === 'brew') {
      const subcmd = args[0]?.toLowerCase();
      const pkgTargets = args.slice(1).filter((a) => !a.startsWith('-'));

      if (subcmd === 'install') {
        if (pkgTargets.length === 0) {
          return { output: '', error: 'Error: This command requires a formula argument', newCwd: cwd };
        }

        const logLines: string[] = [];
        const nextInstalled = new Set(this.installedPackages);

        for (const t of pkgTargets) {
          const resolved = resolvePackageName(t);
          const meta = AVAILABLE_PACKAGES[resolved];
          if (!meta) {
            logLines.push(`Error: No available formula with the name "${t}". Did you mean: ${Object.keys(AVAILABLE_PACKAGES).slice(0, 4).join(', ')}?`);
            continue;
          }
          if (nextInstalled.has(meta.name)) {
            logLines.push(`Warning: ${meta.name} ${meta.version.split('-')[0]} is already installed and up-to-date.`);
            continue;
          }

          nextInstalled.add(meta.name);
          const ver = meta.version.split('-')[0];
          logLines.push(`==> Downloading https://ghcr.io/v2/homebrew/core/${meta.name}/manifests/${ver}
==> Fetching ${meta.name}
==> Pouring ${meta.name}--${ver}.x86_64_linux.bottle.tar.gz
🍺  /opt/homebrew/Cellar/${meta.name}/${ver}: 480 files, ${(meta.installedSize / 1024).toFixed(1)}MB
==> Running \`brew cleanup ${meta.name}\`...
==> Caveats
Binaries installed: ${meta.binaries.join(', ')}
Ready to use in shell.`);
        }

        this.installedPackages = nextInstalled;
        this.updateDpkgStatus();

        return {
          output: logLines.join('\n\n'),
          error: '',
          newCwd: cwd,
          installedPackagesChanged: Array.from(nextInstalled),
        };
      }

      if (subcmd === 'uninstall' || subcmd === 'remove') {
        const logLines: string[] = [];
        const nextInstalled = new Set(this.installedPackages);

        for (const t of pkgTargets) {
          const resolved = resolvePackageName(t);
          if (!nextInstalled.has(resolved)) {
            logLines.push(`Error: No such keg: /opt/homebrew/Cellar/${t}`);
            continue;
          }
          nextInstalled.delete(resolved);
          logLines.push(`Uninstalling /opt/homebrew/Cellar/${resolved}...\n(480 files, unlinked)`);
        }

        this.installedPackages = nextInstalled;
        this.updateDpkgStatus();

        return {
          output: logLines.join('\n'),
          error: '',
          newCwd: cwd,
          installedPackagesChanged: Array.from(nextInstalled),
        };
      }

      if (subcmd === 'list' || subcmd === 'ls') {
        const brewPkgs = Array.from(this.installedPackages).filter((p) => AVAILABLE_PACKAGES[p]);
        return {
          output: brewPkgs.join('   ') || 'No packages installed yet.',
          error: '',
          newCwd: cwd,
        };
      }

      if (subcmd === 'search') {
        const q = (pkgTargets[0] || '').toLowerCase();
        const matches = Object.keys(AVAILABLE_PACKAGES).filter((k) => k.includes(q));
        return {
          output: `==> Formulae\n${matches.join('   ')}`,
          error: '',
          newCwd: cwd,
        };
      }

      if (subcmd === 'doctor') {
        return { output: 'Your system is ready to brew.', error: '', newCwd: cwd };
      }

      if (subcmd === 'info') {
        const resolved = resolvePackageName(pkgTargets[0] || '');
        const meta = AVAILABLE_PACKAGES[resolved];
        if (!meta) return { output: '', error: `Error: No available formula with the name "${pkgTargets[0]}"`, newCwd: cwd };
        return {
          output: `${meta.name}: stable ${meta.version.split('-')[0]} (bottled)
${meta.description}
https://theysynced.com
Installed: ${this.installedPackages.has(meta.name) ? 'Yes' : 'No'}
From: https://github.com/Homebrew/homebrew-core/blob/master/Formula/${meta.name}.rb`,
          error: '',
          newCwd: cwd,
        };
      }

      return { output: 'Usage: brew [install|uninstall|list|search|info|doctor]', error: '', newCwd: cwd };
    }

    // ==========================================
    // 16. RUNTIMES: PYTHON / NODE / GIT / CLI
    // ==========================================

    // PYTHON 3: Requires python3 package installed
    if (cmd === 'python' || cmd === 'python3') {
      if (!this.installedPackages.has('python3')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install python3\n  brew install python`,
          newCwd: cwd,
        };
      }
      return {
        output: '__RUN_PYODIDE_OR_REPL__',
        error: '',
        newCwd: cwd,
        enterPythonRepl: args.length === 0,
      };
    }

    // PIP: Requires python3 package installed
    if (cmd === 'pip' || cmd === 'pip3') {
      if (!this.installedPackages.has('python3')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install python3\n  brew install python`,
          newCwd: cwd,
        };
      }
      return {
        output: '__RUN_PYODIDE_PIP__',
        error: '',
        newCwd: cwd,
      };
    }

    // NODE.JS: Requires node package installed
    if (cmd === 'node' || cmd === 'nodejs') {
      if (!this.installedPackages.has('node')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install node\n  brew install node`,
          newCwd: cwd,
        };
      }

      if (args.includes('-v') || args.includes('--version')) {
        return { output: 'v20.11.0', error: '', newCwd: cwd };
      }

      if (args[0] === '-e' && args[1]) {
        try {
          const code = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
          const result = new Function(`return (${code});`)();
          return { output: String(result !== undefined ? result : ''), error: '', newCwd: cwd };
        } catch (e: any) {
          return { output: '', error: `node error: ${e.message}`, newCwd: cwd };
        }
      }

      if (args[0]) {
        const filePath = this.normalizePath(args[0], cwd, effectiveUser);
        const code = this.readFile(filePath);
        if (code === null) return { output: '', error: `node: cannot find module '${args[0]}'`, newCwd: cwd };
        try {
          let outputBuf = '';
          const customConsole = {
            log: (...msgs: any[]) => { outputBuf += msgs.map(String).join(' ') + '\n'; },
            error: (...msgs: any[]) => { outputBuf += msgs.map(String).join(' ') + '\n'; },
          };
          const fn = new Function('console', code);
          fn(customConsole);
          return { output: outputBuf.trim(), error: '', newCwd: cwd };
        } catch (e: any) {
          return { output: '', error: `node runtime error: ${e.message}`, newCwd: cwd };
        }
      }

      return {
        output: '__ENTER_NODE_REPL__',
        error: '',
        newCwd: cwd,
        enterNodeRepl: true,
      };
    }

    // NPM
    if (cmd === 'npm') {
      if (!this.installedPackages.has('node')) {
        return {
          output: '',
          error: `Command 'npm' not found, but can be installed with:\n  sudo apt install node\n  brew install node`,
          newCwd: cwd,
        };
      }
      if (args[0] === '-v' || args[0] === '--version') {
        return { output: '10.2.4', error: '', newCwd: cwd };
      }
      if (args[0] === 'init' && (args[1] === '-y' || args[1] === '--yes')) {
        const pkgJson = JSON.stringify({
          name: this.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          version: '1.0.0',
          description: 'TheySynced workspace project',
          main: 'index.js',
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
          dependencies: {},
        }, null, 2);
        this.writeFile(`${cwd}/package.json`, pkgJson, effectiveUser);
        return { output: `Wrote to ${cwd}/package.json:\n${pkgJson}`, error: '', newCwd: cwd };
      }
      if (args[0] === 'install' || args[0] === 'i') {
        const pkgs = args.slice(1).filter((a) => !a.startsWith('-'));
        return {
          output: `added ${pkgs.length || 1} package in 0.4s\nfound 0 vulnerabilities`,
          error: '',
          newCwd: cwd,
        };
      }
      return { output: 'Usage: npm [install|init|run|-v]', error: '', newCwd: cwd };
    }

    // NEOFETCH
    if (cmd === 'neofetch' || cmd === 'fastfetch') {
      if (!this.installedPackages.has('neofetch')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install neofetch\n  brew install neofetch`,
          newCwd: cwd,
        };
      }
      return {
        output: renderNeofetch(effectiveUser, this.hostname, this.installedPackages.size, 90 * 86400, this.companyName),
        error: '',
        newCwd: cwd,
      };
    }

    // HTOP / TOP
    if (cmd === 'htop' || cmd === 'top') {
      if (!this.installedPackages.has('htop')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install htop\n  brew install htop`,
          newCwd: cwd,
        };
      }
      return {
        output: renderHtop(effectiveUser, this.hostname, Array.from(this.installedPackages)),
        error: '',
        newCwd: cwd,
      };
    }

    // CURL
    if (cmd === 'curl') {
      if (!this.installedPackages.has('curl')) {
        return {
          output: '',
          error: `Command 'curl' not found, but can be installed with:\n  sudo apt install curl\n  brew install curl`,
          newCwd: cwd,
        };
      }
      const url = args.find((a) => !a.startsWith('-'));
      if (!url) return { output: '', error: 'curl: try \'curl --help\' for more information', newCwd: cwd };
      try {
        const res = await fetch(url, { mode: 'cors' });
        const text = await res.text();
        return { output: text.slice(0, 2000), error: '', newCwd: cwd };
      } catch (e: any) {
        return { output: '', error: `curl: (6) Could not resolve host or CORS blocked: ${e.message}`, newCwd: cwd };
      }
    }

    // WGET
    if (cmd === 'wget') {
      if (!this.installedPackages.has('wget')) {
        return {
          output: '',
          error: `Command 'wget' not found, but can be installed with:\n  sudo apt install wget\n  brew install wget`,
          newCwd: cwd,
        };
      }
      const url = args[0];
      if (!url) return { output: '', error: 'wget: missing URL', newCwd: cwd };
      try {
        const res = await fetch(url, { mode: 'cors' });
        const text = await res.text();
        const fname = url.split('/').pop() || 'download.txt';
        this.writeFile(`${cwd}/${fname}`, text, effectiveUser);
        return {
          output: `Saving to: '${fname}'\n${fname} [${text.length} bytes] saved successfully.`,
          error: '',
          newCwd: cwd,
        };
      } catch (e: any) {
        return { output: '', error: `wget: failed to fetch: ${e.message}`, newCwd: cwd };
      }
    }

    // COWSAY
    if (cmd === 'cowsay') {
      if (!this.installedPackages.has('cowsay')) {
        return {
          output: '',
          error: `Command 'cowsay' not found, but can be installed with:\n  sudo apt install cowsay\n  brew install cowsay`,
          newCwd: cwd,
        };
      }
      const text = args.join(' ') || 'Moo!';
      const len = text.length;
      const border = '-'.repeat(len + 2);
      const cow = `
 ${border}
< ${text} >
 ${border}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||
      `.trim();
      return { output: cow, error: '', newCwd: cwd };
    }

    // FIGLET
    if (cmd === 'figlet') {
      if (!this.installedPackages.has('figlet')) {
        return {
          output: '',
          error: `Command 'figlet' not found, but can be installed with:\n  sudo apt install figlet\n  brew install figlet`,
          newCwd: cwd,
        };
      }
      const text = (args.join(' ') || 'THEYSYNCED').toUpperCase();
      const FONT: Record<string, string[]> = {
        A: [' ___ ', '/ _ \\', '|/ \\|', '|   |'],
        B: [' ___ ', '|__)', '|__)', '|___/'],
        C: [' ___ ', '/ __', '| (__', '\\___)'],
        D: [' ___ ', '|  \\ ', '|  | ', '|__/ '],
        E: [' ___ ', '|___', '|__  ', '|___ '],
        F: [' ___ ', '|___', '|__  ', '|    '],
        G: [' ___ ', '/ __', '| (_|', '\\___)'],
        H: ['     ', '|__| ', '|  | ', '|  | '],
        I: [' _ ', ' | ', ' | ', ' _|_'],
        J: ['   _ ', '   | ', '\\  | ', ' \\_/ '],
        K: ['     ', '|__/ ', '| \\  ', '|  \\ '],
        L: ['     ', '|    ', '|    ', '|___ '],
        M: ['     ', '|\\/| ', '|  | ', '|  | '],
        N: ['     ', '|\\ | ', '| \\| ', '|  | '],
        O: [' ___ ', '/ _ \\', '| | |', '\\___/'],
        P: [' ___ ', '|__)', '|    ', '|    '],
        Q: [' ___ ', '/ _ \\', '| |\\|', '\\___\\'],
        R: [' ___ ', '|__)', '| \\  ', '|  \\ '],
        S: [' ___ ', '/ __', '\\__ \\', '___/ '],
        T: [' ___ ', '  |  ', '  |  ', '  |  '],
        U: ['     ', '|  | ', '|  | ', '\\__/ '],
        V: ['     ', '\\  / ', ' \\/  ', '  v  '],
        W: ['     ', '|  | ', '|\\/| ', '|  | '],
        X: ['     ', ' \\_/ ', ' / \\ ', '/   \\'],
        Y: ['     ', '\\  / ', ' \\/  ', ' |   '],
        Z: [' ___ ', '  /  ', ' /   ', '/___ '],
        ' ': ['     ', '     ', '     ', '     '],
      };
      const lines = ['', '', '', ''];
      for (const ch of text) {
        const g = FONT[ch] || FONT[' '];
        for (let i = 0; i < 4; i++) {
          lines[i] += g[i] + ' ';
        }
      }
      return { output: lines.join('\n'), error: '', newCwd: cwd };
    }

    // GIT
    if (cmd === 'git') {
      if (!this.installedPackages.has('git')) {
        return {
          output: '',
          error: `Command 'git' not found, but can be installed with:\n  sudo apt install git\n  brew install git`,
          newCwd: cwd,
        };
      }
      const sub = args[0];
      if (!sub || sub === '--version') return { output: 'git version 2.43.0', error: '', newCwd: cwd };
      if (sub === 'status') {
        return {
          output: `On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean`,
          error: '',
          newCwd: cwd,
        };
      }
      if (sub === 'init') {
        this.mkdir(`${cwd}/.git`, effectiveUser);
        return { output: `Initialized empty Git repository in ${cwd}/.git/`, error: '', newCwd: cwd };
      }
      if (sub === 'log') {
        return {
          output: `commit 86962fe31e08d249f0a2489c742\nAuthor: ${effectiveUser} <${effectiveUser}@theysynced.com>\nDate:   Sun Oct 18 14:00:00 2026\n\n    Initial enterprise workspace commit`,
          error: '',
          newCwd: cwd,
        };
      }
      return { output: `git: '${sub}' executed successfully.`, error: '', newCwd: cwd };
    }

    // GCC
    if (cmd === 'gcc' || cmd === 'g++' || cmd === 'cc') {
      if (!this.installedPackages.has('gcc')) {
        return {
          output: '',
          error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install gcc\n  brew install gcc`,
          newCwd: cwd,
        };
      }
      const srcFile = args.find((a) => a.endsWith('.c') || a.endsWith('.cpp'));
      if (!srcFile) return { output: '', error: 'gcc: fatal error: no input files', newCwd: cwd };
      const outIdx = args.indexOf('-o');
      const outBin = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : 'a.out';
      this.writeFile(`${cwd}/${outBin}`, '#!/bin/sh\necho "Execution of compiled binary ' + outBin + '"', effectiveUser, '0755');
      return { output: `Compiled '${srcFile}' -> '${outBin}' (x86_64-linux-gnu)`, error: '', newCwd: cwd };
    }

    // SYSTEM DIAGNOSTICS
    if (cmd === 'uname') {
      return { output: `Linux ${this.hostname} 6.8.0-enterprise-wasm #1 SMP PREEMPT_DYNAMIC CloudflareEdge x86_64 GNU/Linux`, error: '', newCwd: cwd };
    }
    if (cmd === 'hostname') {
      return { output: this.hostname, error: '', newCwd: cwd };
    }
    if (cmd === 'date') {
      return { output: new Date().toUTCString(), error: '', newCwd: cwd };
    }
    if (cmd === 'uptime') {
      return { output: ` ${new Date().toTimeString().split(' ')[0]} up 90 days, 1 user, load average: 0.04, 0.02, 0.00`, error: '', newCwd: cwd };
    }
    if (cmd === 'whoami') {
      return { output: effectiveUser, error: '', newCwd: cwd };
    }
    if (cmd === 'id') {
      if (effectiveIsRoot) {
        return { output: 'uid=0(root) gid=0(root) groups=0(root)', error: '', newCwd: cwd };
      }
      return { output: `uid=1000(${username}) gid=1000(theysynced) groups=1000(theysynced),27(sudo),100(users)`, error: '', newCwd: cwd };
    }
    if (cmd === 'free') {
      return {
        output: `               total        used        free      shared  buff/cache   available\nMem:            2048         412        1508           8         128        1628\nSwap:              0           0           0`,
        error: '',
        newCwd: cwd,
      };
    }
    if (cmd === 'df') {
      return {
        output: `Filesystem      Size  Used Avail Use% Mounted on\noverlay          10G  160M  9.8G   2% /\ntmpfs           1.0G     0  1.0G   0% /dev`,
        error: '',
        newCwd: cwd,
      };
    }

    // 17. OPEN / XDG-OPEN
    if (cmd === 'open' || cmd === 'xdg-open' || cmd === 'view') {
      if (args.length === 0) {
        return { output: 'Opening GUI File Manager...', error: '', newCwd: cwd, openTab: 'assets', openId: cwd };
      }
      const target = args[0];
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('localhost')) {
        return { output: `Opening '${target}' in Web Browser tab...`, error: '', newCwd: cwd, openTab: 'browser', openId: target };
      }
      const basename = target.split('/').pop()?.toLowerCase() || '';
      if (basename.includes('sheet') || basename.endsWith('.csv')) {
        return { output: `Opening '${basename}' in Spreadsheets Tab...`, error: '', newCwd: cwd, openTab: 'spreadsheet', openId: basename };
      }
      if (basename.includes('excalidraw')) {
        return { output: `Opening '${basename}' in Excalidraw Canvas...`, error: '', newCwd: cwd, openTab: 'whiteboard', openId: basename };
      }
      if (basename.includes('doc') || basename.endsWith('.md')) {
        return { output: `Opening '${basename}' in Docs Tab...`, error: '', newCwd: cwd, openTab: 'docs', openId: basename };
      }
      if (basename.includes('task') || basename.includes('kanban')) {
        return { output: `Opening Jira Tasks Board in Kanban View...`, error: '', newCwd: cwd, openTab: 'tasks', openId: basename };
      }
      if (basename.includes('chat')) {
        return { output: `Opening '${basename}' in Teams & Chat Tab...`, error: '', newCwd: cwd, openTab: 'teams', openId: basename };
      }
      return { output: `Opening '${basename}' in GUI File Manager...`, error: '', newCwd: cwd, openTab: 'assets', openId: basename };
    }

    // 18. JIRA TASK CLI
    if (cmd === 'task' || cmd === 'tasks' || cmd === 'jira') {
      const sub = args[0]?.toLowerCase() || 'list';
      if (sub === 'list' || sub === 'ls') {
        const tasksContent = this.readFile('/workspace/tasks/tasks.json');
        if (!tasksContent) return { output: 'No tasks found. Use: task add "<title>"', error: '', newCwd: cwd };
        try {
          const tasks = JSON.parse(tasksContent);
          const lines = [`${'ID'.padEnd(8)} ${'STATUS'.padEnd(14)} ${'PRIORITY'.padEnd(10)} ${'ASSIGNEE'.padEnd(16)} TITLE`, '-'.repeat(75)];
          tasks.forEach((t: any) => {
            lines.push(`${(t.id || 'TS-?').padEnd(8)} ${(t.status || 'todo').toUpperCase().padEnd(14)} ${(t.priority || 'medium').toUpperCase().padEnd(10)} @${(t.assignee || 'unassigned').padEnd(15)} ${t.title || ''}`);
          });
          return { output: lines.join('\n'), error: '', newCwd: cwd };
        } catch (_) {
          return { output: 'Failed to read tasks file.', error: '', newCwd: cwd };
        }
      }
      if (sub === 'open' || sub === 'board') {
        return { output: 'Opening Jira Tasks Kanban Board...', error: '', newCwd: cwd, openTab: 'tasks', openId: 'board' };
      }
      return { output: 'Usage: task [list|open]', error: '', newCwd: cwd };
    }

    // 19. BROWSER CLI
    if (cmd === 'browser' || cmd === 'browse' || cmd === 'surf') {
      const targetUrl = args[0] || 'http://localhost:3000';
      return { output: `Opening '${targetUrl}' in Web Browser tab...`, error: '', newCwd: cwd, openTab: 'browser', openId: targetUrl };
    }

    // Check if command is a binary from an uninstalled package
    const foundPkg = Object.values(AVAILABLE_PACKAGES).find((p) => p.binaries.includes(cmd) || p.name === cmd);
    if (foundPkg) {
      return {
        output: '',
        error: `Command '${cmd}' not found, but can be installed with:\n  sudo apt install ${foundPkg.name}\n  brew install ${foundPkg.name}`,
        newCwd: cwd,
      };
    }

    // Check for local executable ./a.out
    if (cmd.startsWith('./')) {
      const p = this.normalizePath(cmd.slice(2), cwd, effectiveUser);
      const node = this.stat(p);
      if (node && node.type === 'file') {
        return { output: `Execution of binary: ${cmd.slice(2)} [Completed with return code 0]`, error: '', newCwd: cwd };
      }
    }

    return { output: '', error: `bash: ${cmd}: command not found. Type 'help' for built-in Linux commands, or 'apt list' to search packages.`, newCwd: cwd };
  }

  private parseArgs(cmdStr: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < cmdStr.length; i++) {
      const ch = cmdStr[i];
      if ((ch === '"' || ch === "'") && (!inQuotes || quoteChar === ch)) {
        inQuotes = !inQuotes;
        quoteChar = inQuotes ? ch : '';
      } else if (ch === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }
}
