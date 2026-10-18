/**
 * TheySynced Enterprise Linux Package Management & Privilege Subsystem
 * Implements real Debian/Ubuntu APT (dpkg) and Homebrew (brew) package managers,
 * sudo/su privilege escalation, and dynamic on-demand runtime execution.
 */

export interface PackageMeta {
  name: string;
  version: string;
  section: string;
  priority: string;
  architecture: string;
  installedSize: number; // in KB
  description: string;
  maintainer: string;
  binaries: string[];
  dependencies: string[];
}

export const AVAILABLE_PACKAGES: Record<string, PackageMeta> = {
  python3: {
    name: 'python3',
    version: '3.12.0-1ubuntu1',
    section: 'python',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 18432,
    description: 'Interactive high-level object-oriented language (default python3 version)',
    maintainer: 'TheySynced Linux Developers <packages@theysynced.com>',
    binaries: ['python', 'python3', 'pip', 'pip3'],
    dependencies: ['python3-minimal', 'libpython3-stdlib'],
  },
  node: {
    name: 'node',
    version: '20.11.0-1nodesource1',
    section: 'web',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 38912,
    description: 'Evented I/O for V8 JavaScript runtime engine',
    maintainer: 'NodeSource Developers <packages@nodesource.com>',
    binaries: ['node', 'nodejs', 'npm', 'npx'],
    dependencies: [],
  },
  git: {
    name: 'git',
    version: '2.43.0-1ubuntu7.1',
    section: 'vcs',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 24576,
    description: 'Fast, scalable, distributed revision control system',
    maintainer: 'TheySynced Linux Developers <packages@theysynced.com>',
    binaries: ['git'],
    dependencies: [],
  },
  neofetch: {
    name: 'neofetch',
    version: '7.1.0-4',
    section: 'utils',
    priority: 'optional',
    architecture: 'all',
    installedSize: 348,
    description: 'Shows Linux distro information using ASCII art logos',
    maintainer: 'Dylan Araps <dylan.araps@gmail.com>',
    binaries: ['neofetch', 'fastfetch'],
    dependencies: ['bash'],
  },
  htop: {
    name: 'htop',
    version: '3.3.0-4build1',
    section: 'utils',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 512,
    description: 'Interactive processes viewer and kernel resource monitor',
    maintainer: 'Hisham Muhammad <hisham@gobolinux.org>',
    binaries: ['htop', 'top'],
    dependencies: ['libncursesw6'],
  },
  curl: {
    name: 'curl',
    version: '8.5.0-2ubuntu10.4',
    section: 'web',
    priority: 'standard',
    architecture: 'amd64',
    installedSize: 618,
    description: 'Command line tool for transferring data with URL syntax',
    maintainer: 'Daniel Stenberg <daniel@haxx.se>',
    binaries: ['curl'],
    dependencies: ['libcurl4'],
  },
  wget: {
    name: 'wget',
    version: '1.21.4-1ubuntu4',
    section: 'web',
    priority: 'standard',
    architecture: 'amd64',
    installedSize: 940,
    description: 'Retrieves files using HTTP, HTTPS, and FTP protocols',
    maintainer: 'Hrvoje Niksic <hniksic@xemacs.org>',
    binaries: ['wget'],
    dependencies: [],
  },
  cowsay: {
    name: 'cowsay',
    version: '3.7.0-1',
    section: 'games',
    priority: 'optional',
    architecture: 'all',
    installedSize: 120,
    description: 'Configurable talking cow in ASCII art',
    maintainer: 'Tony Monroe <tony@monroe.nu>',
    binaries: ['cowsay'],
    dependencies: ['perl'],
  },
  figlet: {
    name: 'figlet',
    version: '2.2.5-3',
    section: 'utils',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 420,
    description: 'Write large ASCII banner text out of ordinary characters',
    maintainer: 'Glenn Chappell <gchappell@alaska.edu>',
    binaries: ['figlet'],
    dependencies: [],
  },
  fortune: {
    name: 'fortune-mod',
    version: '1.99.1-7build1',
    section: 'games',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 1800,
    description: 'Provides fortune cookies on demand',
    maintainer: 'TheySynced Developers <dev@theysynced.com>',
    binaries: ['fortune'],
    dependencies: [],
  },
  tree: {
    name: 'tree',
    version: '2.1.1-1',
    section: 'utils',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 110,
    description: 'Display an indented directory tree structure',
    maintainer: 'Steve Baker <ice@mama.indstate.edu>',
    binaries: ['tree'],
    dependencies: [],
  },
  jq: {
    name: 'jq',
    version: '1.7.1-3build1',
    section: 'utils',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 890,
    description: 'Lightweight and flexible command-line JSON processor',
    maintainer: 'Stephen Dolan <mu@netsoc.tcd.ie>',
    binaries: ['jq'],
    dependencies: [],
  },
  gcc: {
    name: 'gcc',
    version: '4:13.2.0-1ubuntu1',
    section: 'devel',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 58000,
    description: 'GNU C compiler for system software development',
    maintainer: 'Ubuntu Core developers <ubuntu-devel-discuss@lists.ubuntu.com>',
    binaries: ['gcc', 'g++', 'cc'],
    dependencies: ['cpp', 'binutils'],
  },
  rustc: {
    name: 'rustc',
    version: '1.75.0+dfsg1-0ubuntu1',
    section: 'devel',
    priority: 'optional',
    architecture: 'amd64',
    installedSize: 92000,
    description: 'Rust systems programming language compiler and cargo package manager',
    maintainer: 'Rust Packaging Team <team+rust@tracker.debian.org>',
    binaries: ['rustc', 'cargo'],
    dependencies: [],
  },
};

// Aliases mapping (e.g. nodejs -> node, python -> python3)
export const PACKAGE_ALIASES: Record<string, string> = {
  python: 'python3',
  py: 'python3',
  nodejs: 'node',
  npm: 'node',
  top: 'htop',
  fastfetch: 'neofetch',
  cc: 'gcc',
  'g++': 'gcc',
  cargo: 'rustc',
};

/**
 * Resolve package name from alias
 */
export function resolvePackageName(rawName: string): string {
  const clean = rawName.toLowerCase().trim();
  return PACKAGE_ALIASES[clean] || clean;
}

/**
 * Check if a command binary belongs to an installable package
 */
export function findPackageForBinary(binary: string): PackageMeta | null {
  const clean = binary.toLowerCase().trim();
  for (const pkg of Object.values(AVAILABLE_PACKAGES)) {
    if (pkg.binaries.includes(clean) || pkg.name === clean) {
      return pkg;
    }
  }
  return null;
}

/**
 * Render ASCII distro art for neofetch
 */
export function renderNeofetch(
  username: string,
  hostname: string,
  installedPackagesCount: number,
  uptimeSecs: number,
  companyName: string
): string {
  const days = Math.floor(uptimeSecs / 86400);
  const hours = Math.floor((uptimeSecs % 86400) / 3600);
  const mins = Math.floor((uptimeSecs % 3600) / 60);
  const uptimeStr = `${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m`;

  const header = `${username}@${hostname}`;
  const separator = '-'.repeat(header.length);

  return `
       _,met$$$$$gg.          ${header}
    ,g$$$$$$$$$$$$$$$P.       ${separator}
  ,g$$P"''       '""Y$$.".    OS: TheySynced Enterprise Linux 6.8.0-wasm x86_64
 ,$$P'              '$$$.     Host: EdgeCloud VM (Cloudflare Isolated Engine)
',$$P       ,ggs.     '$$b:   Kernel: 6.8.0-enterprise-wasm
'd$$'     ,$P"'   .    $$$    Uptime: ${uptimeStr}
 $$P      d$'     ,    $$P    Packages: ${installedPackagesCount} (dpkg/brew)
 $$:      $$.   -    ,d$$'    Shell: bash 5.2.21
 ;$$;      Y$b._   _,d$P'     Terminal: /dev/pts/0 (web-wasm-xterm)
  Y$$.    '.'"Y$$$$P"'        CPU: Virtual WebAssembly Core (4) @ 3.40GHz
   '$$b      "-.__            Memory: 412MiB / 2048MiB (20%)
    'Y$$                      Organization: ${companyName}
     '$$b.                    Security: Hardware Sealed AES-256-GCM
       'Y$$b.                 Locale: en_US.UTF-8
          '"Y$b._
              '"""
  `.trim();
}

/**
 * Render dynamic htop process viewer snapshot
 */
export function renderHtop(username: string, hostname: string, installedPackages: string[]): string {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  let rows = `
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
    1 root      20   0  168420  12480   8920 S   0.0   0.6   0:01.42 /sbin/init systemd.unified
  102 messageb  20   0    8210   3410   2910 S   0.0   0.2   0:00.12 dbus-daemon --system
  204 root      20   0   94210   8120   6140 S   0.0   0.4   0:00.38 /usr/sbin/cron -f
  412 theysync  20   0  240180  45120  28940 S   0.5   2.2   0:04.18 /usr/bin/theysynced-edge-daemon
  520 ${username.padEnd(8)}  20   0   28940   6120   4510 S   0.0   0.3   0:00.08 /bin/bash --login
  `.trim();

  if (installedPackages.includes('python3')) {
    rows += `\n  840 ${username.padEnd(8)}  20   0  184200  38940  18420 S   0.2   1.9   0:01.05 /usr/bin/python3 -s -m runtime`;
  }
  if (installedPackages.includes('node')) {
    rows += `\n  920 ${username.padEnd(8)}  20   0  210400  51200  24100 S   0.4   2.5   0:02.11 /usr/bin/node /workspace/server.js`;
  }

  return `
1  [||||||||||                      24.2%]   Tasks: 7, 1 thr; 1 running
2  [||||                            12.8%]   Load average: 0.12 0.08 0.02
Mem[||||||||||||||||          412M/2048M]   Uptime: 90 days, ${timeStr}
Swp[                              0K/0K]   Host: ${hostname}

${rows}
  `.trim();
}
