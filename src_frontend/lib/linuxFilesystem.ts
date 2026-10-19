import { Company, Team, ChatMessage, WorkspaceAsset, UserProfile } from '../types';

export type InodeKind = 'dir' | 'file' | 'chat' | 'sheet' | 'doc' | 'board' | 'task' | 'symlink';

export interface VfsInode {
  company_id: string;
  id: string;
  parent_id: string | null;
  name: string;
  kind: InodeKind;
  owner: string;
  gid: string;
  mode: number;
  sealed: boolean;
  size: number;
  mtime: string;
  ctime: string;
  blob_ref: string | null;
  meta_json: string | null;
}

export interface VfsAcl {
  company_id: string;
  inode_id: string;
  uid: string;
  perms: number;
}

export interface VfsMessage {
  company_id: string;
  id: string;
  chat_inode_id: string;
  sender_uid: string;
  ts: string;
  body_encrypted: string;
}

export interface VfsEvent {
  company_id: string;
  ts: string;
  uid: string;
  op: string;
  inode_id: string | null;
  path: string | null;
}

export interface LinuxFileEntry {
  path: string;           // e.g. /projects/general/docs/notes.doc
  name: string;           // e.g. notes.doc
  folder: string;         // e.g. /projects/general/docs
  type: 'file' | 'folder';
  category: 'chat' | 'spreadsheet' | 'drawing' | 'doc' | 'file' | 'export' | 'system' | 'home' | 'tasks';
  content?: string;
  size?: number;
  url?: string;
  updated_at: string;
  created_by: string;
  asset_id?: string;
  target_tab?: 'teams' | 'spreadsheet' | 'whiteboard' | 'docs' | 'assets' | 'tasks' | 'browser';
  target_id?: string;
  scope?: 'shared' | 'private' | 'dm';
  allowed_users?: string[];
  mode?: string;          // POSIX permission mode string, e.g. -rw-r--r--
}

/**
 * Format numeric mode to POSIX permission string (-rw-r--r--)
 */
export function formatPosixMode(kind: InodeKind, mode: number): string {
  const typeChar = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-';
  const rwx = (m: number) => [
    (m & 4) ? 'r' : '-',
    (m & 2) ? 'w' : '-',
    (m & 1) ? 'x' : '-',
  ].join('');
  const u = rwx((mode >> 6) & 7);
  const g = rwx((mode >> 3) & 7);
  const o = rwx(mode & 7);
  return `${typeChar}${u}${g}${o}`;
}

/**
 * Check if the active user has Admin / Owner privileges in the organization
 */
export function isUserCompanyAdmin(company: Company, user: UserProfile): boolean {
  if (company.owner_id === user.id) return true;
  return (company.members || []).some(
    (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
  );
}

/**
 * Check if a DM team channel involves the specified user
 */
export function isUserParticipantInDm(team: Team, messages: ChatMessage[], user: UserProfile): boolean {
  const lowerName = team.name.toLowerCase();
  const lowerUser = user.username.toLowerCase();

  if (lowerName.includes(lowerUser)) return true;
  if (messages.some((m) => m.team_id === team.id && (m.username?.toLowerCase() === lowerUser || m.user_id === user.id))) {
    return true;
  }
  return false;
}

/**
 * Convert HTML content from Docs into clean readable Markdown/Plaintext
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<ul[^>]*>/gi, '')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Convert 2D Grid data from Spreadsheets into standard CSV
 */
export function gridToCsv(grid: string[][]): string {
  if (!Array.isArray(grid)) return '';
  return grid.map((row) => {
    return row.map((cell) => {
      const str = String(cell ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  }).join('\n');
}

/**
 * Real VFS Client for /api/vfs/* HTTP syscalls and /ws/vfs live events
 */
export class VfsClient {
  private token: string;
  private companyId: string;
  private baseUrl: string;

  constructor(token: string, companyId: string, baseUrl: string = '') {
    this.token = token;
    this.companyId = companyId;
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const url = new URL(`${this.baseUrl}${endpoint}`, origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url.toString(), {
      ...options,
      headers,
    });

    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || data.message || `VFS request failed with status ${res.status}`);
    }
    return data;
  }

  // ── Syscalls ───────────────────────────────────────────────────────────────

  async stat(path: string): Promise<VfsInode> {
    const data = await this.request<{ success: boolean; inode: VfsInode }>(
      `/api/vfs/stat?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}`
    );
    return data.inode;
  }

  async readdir(path: string): Promise<VfsInode[]> {
    const data = await this.request<{ success: boolean; entries: VfsInode[] }>(
      `/api/vfs/readdir?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}`
    );
    return data.entries;
  }

  async read(path: string): Promise<string> {
    const data = await this.request<{ success: boolean; data: string; size: number }>(
      `/api/vfs/read?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}`
    );
    return data.data;
  }

  async write(path: string, content: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/write`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        data: content,
      }),
    });
  }

  async create(path: string, kind: InodeKind = 'file', mode: number = 0o644): Promise<VfsInode> {
    const data = await this.request<{ success: boolean; inode: VfsInode }>(`/api/vfs/create`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        kind,
        mode,
      }),
    });
    return data.inode;
  }

  async mkdir(path: string, mode: number = 0o755): Promise<VfsInode> {
    const data = await this.request<{ success: boolean; inode: VfsInode }>(`/api/vfs/mkdir`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        mode,
      }),
    });
    return data.inode;
  }

  async unlink(path: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/unlink`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
      }),
    });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/rename`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        old_path: oldPath,
        new_path: newPath,
      }),
    });
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/chmod`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        mode,
      }),
    });
  }

  async chown(path: string, newOwner: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/chown`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        new_owner: newOwner,
      }),
    });
  }

  async chgrp(path: string, newGid: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/chgrp`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        new_gid: newGid,
      }),
    });
  }

  async symlink(target: string, linkPath: string): Promise<VfsInode> {
    const data = await this.request<{ success: boolean; inode: VfsInode }>(`/api/vfs/symlink`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        target,
        link_path: linkPath,
      }),
    });
    return data.inode;
  }

  async readlink(path: string): Promise<string> {
    const data = await this.request<{ success: boolean; target: string }>(
      `/api/vfs/readlink?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}`
    );
    return data.target;
  }

  async setfacl(path: string, targetUid: string, perms: number): Promise<void> {
    await this.request<{ success: boolean }>(`/api/vfs/setfacl`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        target_uid: targetUid,
        perms,
      }),
    });
  }

  async getfacl(path: string): Promise<VfsAcl[]> {
    const data = await this.request<{ success: boolean; acls: VfsAcl[] }>(
      `/api/vfs/getfacl?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}`
    );
    return data.acls;
  }

  async readMessages(path: string, limit: number = 100): Promise<VfsMessage[]> {
    const data = await this.request<{ success: boolean; messages: VfsMessage[] }>(
      `/api/vfs/read_messages?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}&path=${encodeURIComponent(path)}&limit=${limit}`
    );
    return data.messages;
  }

  async appendMessage(path: string, bodyText: string): Promise<VfsMessage> {
    const data = await this.request<{ success: boolean; message: VfsMessage }>(`/api/vfs/append_message`, {
      method: 'POST',
      body: JSON.stringify({
        token: this.token,
        company_id: this.companyId,
        path,
        body: bodyText,
      }),
    });
    return data.message;
  }

  // ── WebSocket Change Listener ─────────────────────────────────────────────
  connectWs(onEvent: (event: VfsEvent) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/vfs?token=${encodeURIComponent(this.token)}&company_id=${encodeURIComponent(this.companyId)}`;
    let ws: WebSocket | null = new WebSocket(wsUrl);
    let closed = false;

    ws.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'vfs_event' && payload.data) {
          onEvent(payload.data);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      if (!closed) {
        setTimeout(() => {
          if (!closed) {
            ws = new WebSocket(wsUrl);
          }
        }, 3000);
      }
    };

    return () => {
      closed = true;
      if (ws) {
        ws.close();
        ws = null;
      }
    };
  }
}

/**
 * Map VFS assets, chat messages, and teams into POSIX entries for components that expect
 * LinuxFileEntry lists (such as SharedTerminalView and exports).
 */
export function buildCompanyLinuxFilesystem(
  company: Company,
  teams: Team[],
  messages: ChatMessage[],
  assets: WorkspaceAsset[],
  user: UserProfile
): { entries: LinuxFileEntry[]; virtualAssets: WorkspaceAsset[] } {
  const entries: LinuxFileEntry[] = [];
  const virtualAssets: WorkspaceAsset[] = [];
  const now = new Date().toISOString();
  const isAdmin = isUserCompanyAdmin(company, user);

  // 1. Standard Root Hierarchy
  const rootDirs = ['chats', 'projects', 'home', 'shared', 'var', 'etc', 'tmp', 'proc'];
  rootDirs.forEach((dir) => {
    entries.push({
      path: `/${dir}`,
      name: dir,
      folder: '/',
      type: 'folder',
      category: 'system',
      updated_at: now,
      created_by: 'root',
      mode: 'drwxr-xr-x',
    });
  });

  // User home directory
  entries.push({
    path: `/home/${user.username}`,
    name: user.username,
    folder: '/home',
    type: 'folder',
    category: 'home',
    updated_at: now,
    created_by: user.username,
    scope: 'private',
    mode: 'drwx------',
  });

  // 2. Chats (/chats/public, /chats/private, /chats/dm)
  entries.push({ path: '/chats/public', name: 'public', folder: '/chats', type: 'folder', category: 'chat', updated_at: now, created_by: 'root', mode: 'drwxr-xr-x' });
  entries.push({ path: '/chats/private', name: 'private', folder: '/chats', type: 'folder', category: 'chat', updated_at: now, created_by: 'root', mode: 'drwxr-xr-x' });
  entries.push({ path: '/chats/dm', name: 'dm', folder: '/chats', type: 'folder', category: 'chat', updated_at: now, created_by: 'root', mode: 'drwx--x--x' });

  // Public general chat
  const generalMsgs = messages.filter((m) => !m.team_id || m.team_id === company.id);
  const genLog = generalMsgs.map((m) => `[${m.timestamp}] <${m.username}> ${m.message}`).join('\n') + '\n';
  entries.push({
    path: '/chats/public/general',
    name: 'general',
    folder: '/chats/public',
    type: 'file',
    category: 'chat',
    content: genLog,
    size: genLog.length,
    updated_at: now,
    created_by: 'theysynced-chat',
    mode: '-rw-rw-r--',
    target_tab: 'teams',
  });

  // Team chats and project directories
  teams.forEach((t) => {
    const isDm = t.name.startsWith('DM:') || t.name.startsWith('dm-');
    if (isDm && !isAdmin) {
      if (!isUserParticipantInDm(t, messages, user)) return;
    }

    const cleanTeam = t.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const teamMsgs = messages.filter((m) => m.team_id === t.id);
    const logContent = teamMsgs.map((m) => `[${m.timestamp}] <${m.username}> ${m.message}`).join('\n') + '\n';

    if (isDm) {
      entries.push({
        path: `/chats/dm/${cleanTeam}`,
        name: cleanTeam,
        folder: '/chats/dm',
        type: 'file',
        category: 'chat',
        content: logContent,
        size: logContent.length,
        updated_at: now,
        created_by: 'theysynced-dm',
        mode: '-rw-rw----',
        target_tab: 'teams',
        target_id: t.id,
      });
    } else {
      entries.push({
        path: `/chats/public/${cleanTeam}`,
        name: cleanTeam,
        folder: '/chats/public',
        type: 'file',
        category: 'chat',
        content: logContent,
        size: logContent.length,
        updated_at: now,
        created_by: 'theysynced-chat',
        mode: '-rw-rw-r--',
        target_tab: 'teams',
        target_id: t.id,
      });

      // Project directory: /projects/<team>/{docs, sheets, boards, tasks}
      const projPath = `/projects/${cleanTeam}`;
      entries.push({ path: projPath, name: cleanTeam, folder: '/projects', type: 'folder', category: 'system', updated_at: now, created_by: 'root', mode: 'drwxrwxr-x' });
      for (const sub of ['docs', 'sheets', 'boards', 'tasks']) {
        entries.push({ path: `${projPath}/${sub}`, name: sub, folder: projPath, type: 'folder', category: 'system', updated_at: now, created_by: 'root', mode: 'drwxrwxr-x' });
      }
    }
  });

  // General project subdirectories
  entries.push({ path: '/projects/general', name: 'general', folder: '/projects', type: 'folder', category: 'system', updated_at: now, created_by: 'root', mode: 'drwxrwxr-x' });
  for (const sub of ['docs', 'sheets', 'boards', 'tasks']) {
    entries.push({ path: `/projects/general/${sub}`, name: sub, folder: '/projects/general', type: 'folder', category: 'system', updated_at: now, created_by: 'root', mode: 'drwxrwxr-x' });
  }

  // 3. Workspace Assets mapped to real VFS paths
  assets.forEach((a) => {
    let sub = 'docs';
    let cat: LinuxFileEntry['category'] = 'doc';
    let ext = '.doc';
    let targetTab: LinuxFileEntry['target_tab'] = 'docs';

    if (a.asset_type === 'spreadsheet') {
      sub = 'sheets';
      cat = 'spreadsheet';
      ext = '.sheet';
      targetTab = 'spreadsheet';
    } else if (a.asset_type === 'whiteboard') {
      sub = 'boards';
      cat = 'drawing';
      ext = '.board';
      targetTab = 'whiteboard';
    } else if (a.asset_type === 'task') {
      sub = 'tasks';
      cat = 'tasks';
      ext = '.task';
      targetTab = 'tasks';
    } else if (a.asset_type === 'file' || a.asset_type === 'pdf') {
      cat = 'file';
      ext = '';
      targetTab = 'assets';
    }

    const teamPart = a.team_id ? a.team_id.replace(/^team_/, '') : 'general';
    const folder = a.asset_type === 'file' || a.asset_type === 'pdf' ? '/shared' : `/projects/${teamPart}/${sub}`;
    const cleanFileName = a.name.includes('.') ? a.name : `${a.name}${ext}`;
    const path = `${folder}/${cleanFileName}`;

    entries.push({
      path,
      name: cleanFileName,
      folder,
      type: 'file',
      category: cat,
      content: a.content,
      size: a.content ? a.content.length : a.size || 0,
      url: a.url,
      updated_at: a.updated_at || now,
      created_by: a.created_by || 'user',
      asset_id: a.id,
      target_tab: targetTab,
      target_id: a.id,
      mode: '-rw-rw-r--',
    });

    virtualAssets.push({
      ...a,
      folder_path: folder,
    });
  });

  return { entries, virtualAssets };
}
