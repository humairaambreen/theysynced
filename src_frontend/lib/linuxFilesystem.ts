import { Company, Team, ChatMessage, WorkspaceAsset, UserProfile } from '../types';

export interface LinuxFileEntry {
  path: string;           // e.g. /workspace/chats/general.log
  name: string;           // e.g. general.log
  folder: string;         // e.g. /workspace/chats
  type: 'file' | 'folder';
  category: 'chat' | 'spreadsheet' | 'drawing' | 'doc' | 'file' | 'export' | 'system' | 'home';
  content?: string;
  size?: number;
  url?: string;
  updated_at: string;
  created_by: string;
  asset_id?: string;
  target_tab?: 'teams' | 'spreadsheet' | 'whiteboard' | 'docs' | 'assets';
  target_id?: string;
  scope?: 'shared' | 'private' | 'dm';
  allowed_users?: string[];
  mode?: string;          // POSIX permission mode string, e.g. -rw-------
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

  // 1. Direct name match in channel title (e.g. "DM:aryan & humaira" or "dm-aryan-humaira")
  if (lowerName.includes(lowerUser)) return true;

  // 2. Check if team messages contain messages from this user or sent to this user
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
 * Build unified, permission-hardened Linux Filesystem representing all Company data.
 * SECURITY GUARANTEE:
 * - Direct Message (DM) chat files are strictly limited to the participating users and Admins.
 *   Unauthorized users will NOT see or have files mounted for DMs they do not belong to.
 * - Private assets and user home folders (/home/<username>) are restricted strictly to that user and Admin.
 * - Standard company shared files in /workspace/ are accessible across the organization.
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
  const currentUsernameLower = user.username.toLowerCase();

  // 1. Root & Workspace Directories
  const rootFolders = ['chats', 'spreadsheets', 'drawings', 'docs', 'files', 'export'];
  rootFolders.forEach((rf) => {
    entries.push({
      path: `/workspace/${rf}`,
      name: rf,
      folder: '/workspace',
      type: 'folder',
      category: rf as any,
      updated_at: now,
      created_by: 'system',
      mode: 'drwxr-xr-x',
    });
  });

  // User Home Directory (/home/<username>) - strictly private (0700)
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

  // 2. CHATS -> /workspace/chats/<channel>.log and .chat.json
  const activeTeams = teams.length > 0 ? teams : [
    { id: `team_${company.id}_gen`, company_id: company.id, name: 'General', description: 'General discussions', created_at: now }
  ];

  activeTeams.forEach((t) => {
    const isDm = t.name.startsWith('DM:') || t.name.startsWith('dm-');
    
    // ACL Check: If this is a DM channel, only participants and Admins can access it
    if (isDm && !isAdmin) {
      const userAllowed = isUserParticipantInDm(t, messages, user);
      if (!userAllowed) {
        // Unauthorized: current user is not in this DM. Strictly exclude from filesystem.
        return;
      }
    }

    const cleanName = (isDm ? t.name.replace('DM:', 'dm-') : t.name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');

    const channelMsgs = messages.filter((m) => {
      if (m.team_id === t.id) return true;
      if (cleanName === 'general' && (m.team_id === company.id || !m.team_id)) return true;
      return false;
    });

    const logLines = channelMsgs.map((m) => {
      const ts = m.timestamp ? new Date(m.timestamp).toISOString().replace('T', ' ').substring(0, 19) : now.substring(0, 19);
      let line = `[${ts}] <${m.username}> ${m.message}`;
      if (m.file_attachment) {
        line += ` [Attachment: ${m.file_attachment.name} (${m.file_attachment.url})]`;
      }
      return line;
    });

    const logContent = logLines.length > 0
      ? `# TheySynced Chat Log: #${t.name}\n# Channel ID: ${t.id}\n# Total Messages: ${channelMsgs.length}\n# Security Scope: ${isDm ? 'Private DM (Restricted)' : 'Company Shared'}\n\n` + logLines.join('\n') + '\n'
      : `# TheySynced Chat Log: #${t.name}\n# Channel ID: ${t.id}\n(No messages recorded yet)\n`;

    const jsonContent = JSON.stringify(channelMsgs, null, 2);

    // .log entry
    entries.push({
      path: `/workspace/chats/${cleanName}.log`,
      name: `${cleanName}.log`,
      folder: '/workspace/chats',
      type: 'file',
      category: 'chat',
      content: logContent,
      size: logContent.length,
      updated_at: channelMsgs[channelMsgs.length - 1]?.timestamp || now,
      created_by: isDm ? 'Private DM' : 'theysynced-chat',
      scope: isDm ? 'dm' : 'shared',
      mode: isDm ? '-rw-------' : '-rw-r--r--',
      target_tab: 'teams',
      target_id: t.id,
    });

    // .chat.json entry
    entries.push({
      path: `/workspace/chats/${cleanName}.chat.json`,
      name: `${cleanName}.chat.json`,
      folder: '/workspace/chats',
      type: 'file',
      category: 'chat',
      content: jsonContent,
      size: jsonContent.length,
      updated_at: channelMsgs[channelMsgs.length - 1]?.timestamp || now,
      created_by: isDm ? 'Private DM' : 'theysynced-chat',
      scope: isDm ? 'dm' : 'shared',
      mode: isDm ? '-rw-------' : '-rw-r--r--',
      target_tab: 'teams',
      target_id: t.id,
    });

    // Mirror to Virtual Assets for GUI File Manager
    virtualAssets.push({
      id: `chat_asset_${t.id}_log`,
      company_id: company.id,
      asset_type: 'file',
      name: `${cleanName}.log`,
      folder_path: isDm ? '/Chat Attachments/Direct Messages' : '/Chat Logs',
      parent_id: 'v_linux_chats',
      content: logContent,
      size: logContent.length,
      created_by: isDm ? 'Private DM' : 'Chat Service',
      updated_at: channelMsgs[channelMsgs.length - 1]?.timestamp || now,
      scope: isDm ? 'dm' : 'shared',
    });
  });

  // 3. SPREADSHEETS -> /workspace/spreadsheets/<title>.sheet.json & .csv
  const sheetAssets = assets.filter((a) => a.asset_type === 'spreadsheet');
  if (sheetAssets.length === 0) {
    const defaultData = [
      ['Teammate', 'Q1 Target', 'Q2 Target', 'Q3 Target', 'Annual Target'],
      ['Aryan Rao', '12000', '14000', '18000', '44000'],
      ['Humaira Ambreen', '15000', '16500', '21000', '52500'],
      ['Total', '27000', '30500', '39000', '96500'],
    ];
    const csv = gridToCsv(defaultData);
    const jsonStr = JSON.stringify({ title: 'Enterprise Financial Sheet', data: defaultData }, null, 2);

    entries.push({
      path: '/workspace/spreadsheets/financial_sheet.csv',
      name: 'financial_sheet.csv',
      folder: '/workspace/spreadsheets',
      type: 'file',
      category: 'spreadsheet',
      content: csv,
      size: csv.length,
      updated_at: now,
      created_by: user.username,
      scope: 'shared',
      mode: '-rw-r--r--',
      target_tab: 'spreadsheet',
      target_id: `spreadsheet_${company.id}`,
    });

    entries.push({
      path: '/workspace/spreadsheets/financial_sheet.sheet.json',
      name: 'financial_sheet.sheet.json',
      folder: '/workspace/spreadsheets',
      type: 'file',
      category: 'spreadsheet',
      content: jsonStr,
      size: jsonStr.length,
      updated_at: now,
      created_by: user.username,
      scope: 'shared',
      mode: '-rw-r--r--',
      target_tab: 'spreadsheet',
      target_id: `spreadsheet_${company.id}`,
    });
  } else {
    sheetAssets.forEach((sa) => {
      // Permission check: if private, only creator and Admin
      if (sa.scope === 'private' && !isAdmin && sa.created_by.toLowerCase() !== currentUsernameLower) {
        return;
      }

      const cleanName = (sa.name || 'sheet')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/\.sheet\.json$/, '')
        .replace(/\.csv$/, '');

      let grid: string[][] = [];
      try {
        const parsed = JSON.parse(sa.content || '{}');
        if (Array.isArray(parsed.data)) grid = parsed.data;
      } catch (_) {}

      const csv = gridToCsv(grid);
      const jsonStr = sa.content || '{}';

      entries.push({
        path: `/workspace/spreadsheets/${cleanName}.csv`,
        name: `${cleanName}.csv`,
        folder: '/workspace/spreadsheets',
        type: 'file',
        category: 'spreadsheet',
        content: csv,
        size: csv.length,
        updated_at: sa.updated_at || now,
        created_by: sa.created_by || user.username,
        asset_id: sa.id,
        scope: sa.scope || 'shared',
        mode: sa.scope === 'private' ? '-rw-------' : '-rw-r--r--',
        target_tab: 'spreadsheet',
        target_id: sa.id,
      });

      entries.push({
        path: `/workspace/spreadsheets/${cleanName}.sheet.json`,
        name: `${cleanName}.sheet.json`,
        folder: '/workspace/spreadsheets',
        type: 'file',
        category: 'spreadsheet',
        content: jsonStr,
        size: jsonStr.length,
        updated_at: sa.updated_at || now,
        created_by: sa.created_by || user.username,
        asset_id: sa.id,
        scope: sa.scope || 'shared',
        mode: sa.scope === 'private' ? '-rw-------' : '-rw-r--r--',
        target_tab: 'spreadsheet',
        target_id: sa.id,
      });
    });
  }

  // 4. DRAWINGS -> /workspace/drawings/<title>.excalidraw.json
  const whiteboardAssets = assets.filter((a) => a.asset_type === 'whiteboard');
  if (whiteboardAssets.length === 0) {
    const defaultJson = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { theme: 'light' } }, null, 2);
    entries.push({
      path: '/workspace/drawings/system_architecture.excalidraw.json',
      name: 'system_architecture.excalidraw.json',
      folder: '/workspace/drawings',
      type: 'file',
      category: 'drawing',
      content: defaultJson,
      size: defaultJson.length,
      updated_at: now,
      created_by: user.username,
      scope: 'shared',
      mode: '-rw-r--r--',
      target_tab: 'whiteboard',
      target_id: `excalidraw_${company.id}`,
    });
  } else {
    whiteboardAssets.forEach((wa) => {
      if (wa.scope === 'private' && !isAdmin && wa.created_by.toLowerCase() !== currentUsernameLower) {
        return;
      }

      const cleanName = (wa.name || 'drawing')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/\.excalidraw\.json$/, '');

      entries.push({
        path: `/workspace/drawings/${cleanName}.excalidraw.json`,
        name: `${cleanName}.excalidraw.json`,
        folder: '/workspace/drawings',
        type: 'file',
        category: 'drawing',
        content: wa.content || '{}',
        size: (wa.content || '{}').length,
        updated_at: wa.updated_at || now,
        created_by: wa.created_by || user.username,
        asset_id: wa.id,
        scope: wa.scope || 'shared',
        mode: wa.scope === 'private' ? '-rw-------' : '-rw-r--r--',
        target_tab: 'whiteboard',
        target_id: wa.id,
      });
    });
  }

  // 5. DOCS -> /workspace/docs/<title>.md & .doc.html
  const docAssets = assets.filter((a) => a.asset_type === 'doc');
  if (docAssets.length === 0) {
    const defaultMd = `# ${company.name} Workspace Master Document\n\nWelcome to your organization's unified knowledgebase. This document is fully synchronized with your company's Linux filesystem.\n`;
    entries.push({
      path: '/workspace/docs/master_document.md',
      name: 'master_document.md',
      folder: '/workspace/docs',
      type: 'file',
      category: 'doc',
      content: defaultMd,
      size: defaultMd.length,
      updated_at: now,
      created_by: user.username,
      scope: 'shared',
      mode: '-rw-r--r--',
      target_tab: 'docs',
      target_id: `doc_${company.id}`,
    });
  } else {
    docAssets.forEach((da) => {
      if (da.scope === 'private' && !isAdmin && da.created_by.toLowerCase() !== currentUsernameLower) {
        return;
      }

      const cleanName = (da.name || 'document')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/\.md$/, '')
        .replace(/\.doc\.html$/, '');

      const mdContent = da.content?.startsWith('<') ? htmlToMarkdown(da.content) : (da.content || '');
      entries.push({
        path: `/workspace/docs/${cleanName}.md`,
        name: `${cleanName}.md`,
        folder: '/workspace/docs',
        type: 'file',
        category: 'doc',
        content: mdContent,
        size: mdContent.length,
        updated_at: da.updated_at || now,
        created_by: da.created_by || user.username,
        asset_id: da.id,
        scope: da.scope || 'shared',
        mode: da.scope === 'private' ? '-rw-------' : '-rw-r--r--',
        target_tab: 'docs',
        target_id: da.id,
      });
    });
  }

  // 6. FILES & STORAGE -> /workspace/files/... & /home/<username>/
  const standardFiles = assets.filter((a) => a.asset_type === 'file' || a.asset_type === 'pdf');
  standardFiles.forEach((sf) => {
    if (sf.id.startsWith('terminal_') || sf.id.startsWith('chat_asset_')) return;

    // Permission checks
    if (sf.scope === 'private') {
      if (!isAdmin && sf.created_by.toLowerCase() !== currentUsernameLower) {
        return; // Exclude other users' private files
      }
      // Place in user's personal home directory
      entries.push({
        path: `/home/${user.username}/${sf.name}`,
        name: sf.name,
        folder: `/home/${user.username}`,
        type: 'file',
        category: 'home',
        content: sf.content,
        size: sf.size || (sf.content ? sf.content.length : 1024),
        url: sf.url,
        updated_at: sf.updated_at || now,
        created_by: sf.created_by,
        asset_id: sf.id,
        scope: 'private',
        mode: '-rw-------',
        target_tab: 'assets',
        target_id: sf.id,
      });
      return;
    }

    if (sf.allowed_users && sf.allowed_users.length > 0) {
      if (!isAdmin && !sf.allowed_users.some((u) => u.toLowerCase() === currentUsernameLower)) {
        return; // Exclude restricted files
      }
    }

    // Check if it is a DM attachment
    if (sf.scope === 'dm' || sf.folder_path?.includes('/Direct Messages/')) {
      if (!isAdmin) {
        const dmMatch = sf.folder_path?.match(/@([a-zA-Z0-9_.-]+)\s*&\s*@([a-zA-Z0-9_.-]+)/);
        if (dmMatch) {
          const u1 = dmMatch[1].toLowerCase();
          const u2 = dmMatch[2].toLowerCase();
          if (currentUsernameLower !== u1 && currentUsernameLower !== u2) {
            return; // Exclude private DM attachment
          }
        }
      }
    }

    entries.push({
      path: `/workspace/files/${sf.name}`,
      name: sf.name,
      folder: '/workspace/files',
      type: 'file',
      category: 'file',
      content: sf.content,
      size: sf.size || (sf.content ? sf.content.length : 1024),
      url: sf.url,
      updated_at: sf.updated_at || now,
      created_by: sf.created_by || user.username,
      asset_id: sf.id,
      scope: sf.scope || 'shared',
      mode: '-rw-r--r--',
      target_tab: 'assets',
      target_id: sf.id,
    });
  });

  // 7. SYSTEM METADATA -> /etc/theysynced/
  const orgMeta = JSON.stringify({
    organization_id: company.id,
    organization_name: company.name,
    owner_id: company.owner_id,
    created_at: company.created_at,
    join_code: company.join_code,
    encryption: 'AES-256-GCM Hardware Sealed',
    inactivity_purge_policy: '90 Days Total Destruction',
    active_members_count: (company.members || []).length || 1,
    storage_subsystem: 'Cloudflare D1 + KV + R2',
  }, null, 2);

  const membersRoster = (company.members || []).map((m) => 
    `${m.username.padEnd(20)} [Role: ${m.role.padEnd(10)}] Joined: ${m.joined_at?.split('T')[0] || '2026-01-01'}`
  ).join('\n') || `${user.username.padEnd(20)} [Role: Owner     ] Joined: 2026-01-01\n`;

  entries.push({
    path: '/etc/theysynced/organization.json',
    name: 'organization.json',
    folder: '/etc/theysynced',
    type: 'file',
    category: 'system',
    content: orgMeta,
    size: orgMeta.length,
    updated_at: now,
    created_by: 'system',
    mode: '-rw-r--r--',
  });

  entries.push({
    path: '/etc/theysynced/members.txt',
    name: 'members.txt',
    folder: '/etc/theysynced',
    type: 'file',
    category: 'system',
    content: membersRoster,
    size: membersRoster.length,
    updated_at: now,
    created_by: 'system',
    mode: '-rw-r--r--',
  });

  return { entries, virtualAssets };
}
