'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Folder, FolderPlus, Upload, Search, Trash2, Download, 
  ExternalLink, Eye, ChevronRight, FileText, File, FileCode, Lock, X, 
  HardDrive, RefreshCw, MessageSquare, Terminal, Table, 
  PenTool, Code, CheckCircle, CheckSquare, ShieldCheck
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { VfsClient, VfsInode, formatPosixMode, InodeKind } from '../lib/linuxFilesystem';

interface SharedAssetsViewProps {
  user: UserProfile;
  company: Company;
  teams: Team[];
  chatMessages: ChatMessage[];
  assets: WorkspaceAsset[];
  onSaveAsset: (asset: Partial<WorkspaceAsset>) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onRefreshAssets?: () => void;
  onNavigateTab?: (tab: ActiveTab, subItem?: string) => void;
  token?: string;
}

type FilterType = 'all' | 'images' | 'videos' | 'audio' | 'documents' | 'spreadsheets' | 'drawings' | 'chat';

export const SharedAssetsView: React.FC<SharedAssetsViewProps> = ({
  user,
  company,
  teams,
  chatMessages,
  assets,
  onSaveAsset,
  onDeleteAsset,
  onRefreshAssets,
  onNavigateTab,
  token,
}) => {
  // Real VFS Navigation State
  const [currentVfsPath, setCurrentVfsPath] = useState<string>('/');
  const [vfsEntries, setVfsEntries] = useState<VfsInode[]>([]);
  const [vfsLoading, setVfsLoading] = useState<boolean>(false);
  const [vfsError, setVfsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  
  // Modals & Actions State
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  
  const [renameTarget, setRenameTarget] = useState<VfsInode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  const [previewContent, setPreviewContent] = useState<{ name: string; content: string; inode?: VfsInode } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Confirm Modal Config
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const companySlug = useMemo(() => {
    return (company.name || 'org')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || company.id.slice(0, 8);
  }, [company.name, company.id]);

  const isAdmin = useMemo(() => {
    if (company.owner_id === user.id) return true;
    return (company.members || []).some(
      (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
    );
  }, [company, user.id]);

  const effectiveToken = useMemo(() => {
    return token || (typeof window !== 'undefined' ? localStorage.getItem('theysynced_token') || '' : '');
  }, [token]);

  const vfsClient = useMemo(() => {
    return new VfsClient(effectiveToken, company.id);
  }, [effectiveToken, company.id]);

  // Load Real VFS Directory
  const loadVfsDirectory = useCallback(async (path: string) => {
    try {
      setVfsLoading(true);
      setVfsError(null);
      const entries = await vfsClient.readdir(path);
      setVfsEntries(entries);
      setCurrentVfsPath(path);
    } catch (err: any) {
      setVfsError(err.message || 'Failed to list VFS directory');
    } finally {
      setVfsLoading(false);
    }
  }, [vfsClient]);

  // Initial directory load
  useEffect(() => {
    loadVfsDirectory(currentVfsPath);
  }, [loadVfsDirectory, currentVfsPath]);

  // Subscribe to /ws/vfs live events
  useEffect(() => {
    const unsub = vfsClient.connectWs((_event) => {
      loadVfsDirectory(currentVfsPath);
    });
    return () => unsub();
  }, [vfsClient, currentVfsPath, loadVfsDirectory]);

  // Filter items by search and category
  const filteredEntries = useMemo(() => {
    return vfsEntries.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesOwner = item.owner.toLowerCase().includes(q);
        const matchesKind = item.kind.toLowerCase().includes(q);
        if (!matchesName && !matchesOwner && !matchesKind) return false;
      }

      if (item.kind === 'dir') return true;
      if (activeFilter === 'all') return true;
      const ext = item.name.split('.').pop()?.toLowerCase() || '';

      if (activeFilter === 'images') {
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      }
      if (activeFilter === 'videos') {
        return ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext);
      }
      if (activeFilter === 'audio') {
        return ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext);
      }
      if (activeFilter === 'spreadsheets') {
        return ext === 'csv' || ext === 'sheet' || item.name.endsWith('.sheet.json') || item.kind === 'sheet';
      }
      if (activeFilter === 'drawings') {
        return ext === 'board' || item.name.endsWith('.excalidraw.json') || item.kind === 'board';
      }
      if (activeFilter === 'documents') {
        return ext === 'md' || ext === 'doc' || item.name.endsWith('.doc.json') || ext === 'pdf' || ext === 'txt' || item.kind === 'doc';
      }
      if (activeFilter === 'chat') {
        return item.kind === 'chat' || ext === 'log' || item.name.endsWith('.chat.json');
      }
      return true;
    });
  }, [vfsEntries, searchQuery, activeFilter]);

  // Breadcrumbs Navigation
  const breadcrumbSegments = useMemo(() => {
    if (currentVfsPath === '/' || !currentVfsPath) return ['/'];
    const parts = currentVfsPath.split('/').filter(Boolean);
    return ['/', ...parts];
  }, [currentVfsPath]);

  const navigateToBreadcrumb = (index: number) => {
    if (index === 0) {
      loadVfsDirectory('/');
    } else {
      const parts = breadcrumbSegments.slice(1, index + 1);
      const targetPath = '/' + parts.join('/');
      loadVfsDirectory(targetPath);
    }
    setSearchQuery('');
  };

  const handleOpenFolder = (folderName: string) => {
    const nextPath = currentVfsPath === '/' ? `/${folderName}` : `${currentVfsPath}/${folderName}`;
    loadVfsDirectory(nextPath);
    setSearchQuery('');
  };

  // Open File in Visualizer Tab
  const handleOpenInVisualizer = async (inode: VfsInode) => {
    if (!onNavigateTab) return;
    const name = inode.name.toLowerCase();
    const cleanId = inode.id.replace(/^ino_/, '');

    if (inode.kind === 'sheet' || name.endsWith('.sheet') || name.endsWith('.sheet.json') || name.endsWith('.csv')) {
      onNavigateTab('spreadsheet', cleanId);
    } else if (inode.kind === 'board' || name.endsWith('.board') || name.endsWith('.excalidraw.json')) {
      onNavigateTab('whiteboard', cleanId);
    } else if (inode.kind === 'doc' || name.endsWith('.doc') || name.endsWith('.doc.json') || name.endsWith('.md')) {
      onNavigateTab('docs', cleanId);
    } else if (inode.kind === 'task' || name.endsWith('.task') || name.includes('task')) {
      onNavigateTab('tasks', cleanId);
    } else if (inode.kind === 'chat' || name.endsWith('.chat') || name.endsWith('.log')) {
      const teamMatch = teams.find((t) => t.name.toLowerCase() === name || t.id === cleanId);
      onNavigateTab('teams', teamMatch ? teamMatch.id : undefined);
    } else {
      // Preview plaintext file
      await handlePreview(inode);
    }
  };

  const handlePreview = async (inode: VfsInode) => {
    try {
      const fullPath = currentVfsPath === '/' ? `/${inode.name}` : `${currentVfsPath}/${inode.name}`;
      const content = await vfsClient.read(fullPath);
      setPreviewContent({ name: inode.name, content, inode });
    } catch (err: any) {
      setPreviewContent({ name: inode.name, content: `Error reading file: ${err.message}`, inode });
    }
  };

  // Trigger Organization Full Backup
  const handleExportOrgBackup = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupName = `${companySlug}_vfs_backup_${timestamp}.json`;
    
    const exportBundle = {
      organization: company,
      exported_at: new Date().toISOString(),
      channels: teams,
      chat_messages: chatMessages,
      vfs_entries: vfsEntries,
      assets,
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = backupName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setExportNotice(`Exported full encrypted organization archive: ${backupName}`);
    setTimeout(() => setExportNotice(null), 6000);
  };

  // Create New Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const folderPath = currentVfsPath === '/' ? `/${newFolderName.trim()}` : `${currentVfsPath}/${newFolderName.trim()}`;
      await vfsClient.mkdir(folderPath, 0o755);
      setNewFolderName('');
      setShowNewFolderModal(false);
      await loadVfsDirectory(currentVfsPath);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to create folder');
    }
  };

  // Create New File
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    try {
      const filePath = currentVfsPath === '/' ? `/${newFileName.trim()}` : `${currentVfsPath}/${newFileName.trim()}`;
      const kind: InodeKind = newFileName.endsWith('.sheet') ? 'sheet'
        : newFileName.endsWith('.doc') ? 'doc'
        : newFileName.endsWith('.board') ? 'board'
        : newFileName.endsWith('.task') ? 'task'
        : 'file';

      await vfsClient.create(filePath, kind, 0o644);
      if (newFileContent) {
        await vfsClient.write(filePath, newFileContent);
      }

      setNewFileName('');
      setNewFileContent('');
      setShowNewFileModal(false);
      await loadVfsDirectory(currentVfsPath);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to create file');
    }
  };

  // Upload Files into current VFS folder
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        const targetPath = currentVfsPath === '/' ? `/${file.name}` : `${currentVfsPath}/${file.name}`;

        await vfsClient.create(targetPath, 'file', 0o644);
        await vfsClient.write(targetPath, content);
      }
      await loadVfsDirectory(currentVfsPath);
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Delete Item
  const handleDelete = (item: VfsInode) => {
    setConfirmConfig({
      isOpen: true,
      title: `Delete ${item.kind === 'dir' ? 'Folder' : 'File'}`,
      message: `Are you sure you want to delete "${item.name}" from VFS?`,
      onConfirm: async () => {
        try {
          const targetPath = currentVfsPath === '/' ? `/${item.name}` : `${currentVfsPath}/${item.name}`;
          await vfsClient.unlink(targetPath);
          await loadVfsDirectory(currentVfsPath);
        } catch (err: any) {
          setUploadError(err.message || 'Failed to delete file');
        }
        setConfirmConfig(null);
      },
    });
  };

  // Helper to choose item icon
  const getItemIcon = (item: VfsInode) => {
    if (item.kind === 'dir') {
      return <Folder className="w-5 h-5 text-indigo-500 shrink-0 fill-indigo-50" />;
    }
    const name = item.name.toLowerCase();
    if (item.kind === 'sheet' || name.endsWith('.sheet') || name.endsWith('.sheet.json') || name.endsWith('.csv')) {
      return <Table className="w-5 h-5 text-emerald-600 shrink-0" />;
    }
    if (item.kind === 'board' || name.endsWith('.board') || name.endsWith('.excalidraw.json')) {
      return <PenTool className="w-5 h-5 text-purple-600 shrink-0" />;
    }
    if (item.kind === 'doc' || name.endsWith('.doc') || name.endsWith('.doc.json') || name.endsWith('.md')) {
      return <FileText className="w-5 h-5 text-blue-600 shrink-0" />;
    }
    if (item.kind === 'task' || name.endsWith('.task') || name.includes('task')) {
      return <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />;
    }
    if (item.kind === 'chat' || name.endsWith('.chat') || name.endsWith('.log')) {
      return <MessageSquare className="w-5 h-5 text-cyan-600 shrink-0" />;
    }
    if (['py', 'sh', 'js', 'json', 'ts', 'rs', 'toml'].includes(name.split('.').pop() || '')) {
      return <Code className="w-5 h-5 text-amber-500 shrink-0" />;
    }
    return <File className="w-5 h-5 text-slate-400 shrink-0" />;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFAF8] overflow-hidden font-sans">
      
      {/* Top Banner & Global Action Bar */}
      <header className="px-6 py-4 bg-white border-b border-black/[0.04] flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 rounded-2xl text-indigo-600 border border-indigo-100 shadow-sm">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-black text-slate-900 tracking-tight">Virtual Filesystem (VFS)</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                theysynced-{companySlug}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              POSIX virtual filesystem backed by libSQL &bull; AES-256-GCM encryption &bull; Single permission authority
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Open in Linux Terminal */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('terminal', currentVfsPath)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
              title="Open Shell in Linux Terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Open in Terminal</span>
            </button>
          )}

          {/* Export Org Backup */}
          <button
            onClick={handleExportOrgBackup}
            className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
            title="Export Full Organization Archive"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Archive</span>
          </button>

          {/* Upload File */}
          <label className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer transition-all active:scale-95">
            <Upload className="w-3.5 h-3.5" />
            <span>{isUploading ? 'Uploading...' : 'Upload'}</span>
            <input
              type="file"
              multiple
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
            />
          </label>

          {/* New Code / Script File */}
          <button
            onClick={() => setShowNewFileModal(true)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
          >
            <Code className="w-3.5 h-3.5 text-amber-500" />
            <span>New File</span>
          </button>

          {/* New Folder */}
          <button
            onClick={() => setShowNewFolderModal(true)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-600" />
            <span>New Folder</span>
          </button>

          <button
            onClick={() => loadVfsDirectory(currentVfsPath)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
            title="Refresh Directory"
          >
            <RefreshCw className={`w-4 h-4 ${vfsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Export Alert Notification */}
      {exportNotice && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 flex items-center justify-between text-xs text-emerald-800 font-semibold animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span>{exportNotice}</span>
          </div>
          <button onClick={() => setExportNotice(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {(vfsError || uploadError) && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2 flex items-center justify-between text-xs text-rose-800 font-semibold">
          <span>{vfsError || uploadError}</span>
          <button onClick={() => { setVfsError(null); setUploadError(null); }} className="text-rose-600 hover:text-rose-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Breadcrumb Path & Filters */}
      <div className="px-6 py-3 bg-white/60 backdrop-blur-sm border-b border-black/[0.03] flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        {/* Linux Path Breadcrumbs */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 overflow-x-auto w-full md:w-auto py-1 font-mono">
          {breadcrumbSegments.map((segment, idx) => {
            const isLast = idx === breadcrumbSegments.length - 1;
            return (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <button
                  onClick={() => navigateToBreadcrumb(idx)}
                  className={`font-semibold hover:text-indigo-600 truncate max-w-[160px] px-2 py-1 rounded-lg hover:bg-slate-100 ${
                    isLast ? 'text-indigo-600 font-bold bg-indigo-50/70' : 'text-slate-800'
                  }`}
                >
                  {segment === '/' ? '/' : segment}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Filter Pills & Search */}
        <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
          <div className="relative w-full md:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as FilterType)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="spreadsheets">Spreadsheets</option>
            <option value="drawings">Boards & Drawings</option>
            <option value="documents">Docs & MD</option>
            <option value="chat">Chat Channels</option>
            <option value="images">Images</option>
            <option value="videos">Videos</option>
          </select>
        </div>
      </div>

      {/* Main Filesystem View */}
      <div className="flex-1 p-6 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-white rounded-3xl border border-dashed border-slate-200">
            <Folder className="w-10 h-10 text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700">Directory is Empty</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Use &quot;Upload&quot;, &quot;New File&quot;, or the Linux Terminal to create files in this VFS directory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredEntries.map((item) => {
              const isFolder = item.kind === 'dir';
              const posixMode = formatPosixMode(item.kind, item.mode);
              return (
                <div
                  key={item.id}
                  onDoubleClick={() => isFolder ? handleOpenFolder(item.name) : handleOpenInVisualizer(item)}
                  className="group relative bg-white border border-slate-200/80 hover:border-indigo-500/40 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2.5 rounded-xl bg-slate-50 group-hover:bg-indigo-50/50 transition-colors">
                      {getItemIcon(item)}
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      {item.sealed && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center">
                          <Lock className="w-2.5 h-2.5 mr-0.5 text-amber-600" />
                          Sealed
                        </span>
                      )}

                      {!isFolder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInVisualizer(item);
                          }}
                          className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Open in Visualizer Tab"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Open</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900 truncate mb-1" title={item.name}>
                      {item.name}
                    </h4>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>{posixMode}</span>
                      <span>{isFolder ? 'dir' : item.size ? `${(item.size / 1024).toFixed(1)} KB` : '0 B'}</span>
                    </div>
                  </div>

                  {/* Context Actions */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span className="truncate max-w-[120px] text-[10px] text-slate-400">{item.owner}:{item.gid}</span>
                    <div className="flex items-center space-x-1">
                      {!isFolder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePreview(item);
                          }}
                          className="p-1 hover:text-slate-900 rounded"
                          title="Inspect File"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item);
                          }}
                          className="p-1 hover:text-rose-600 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* File Preview Modal */}
      {previewContent && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-xs font-mono">{previewContent.name}</span>
              </div>
              <div className="flex items-center space-x-2">
                {previewContent.inode && (
                  <button
                    onClick={() => {
                      const inod = previewContent.inode!;
                      setPreviewContent(null);
                      handleOpenInVisualizer(inod);
                    }}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center space-x-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open in Visualizer</span>
                  </button>
                )}
                <button onClick={() => setPreviewContent(null)} className="p-1 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-auto bg-slate-950 text-slate-200 font-mono text-xs">
              <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {previewContent.content}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* New Code / Script File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New VFS File</h3>
            <p className="text-xs text-slate-500 mb-4">
              Create a document, sheet, script, or configuration file in {currentVfsPath}.
            </p>

            <form onSubmit={handleCreateFile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">File Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. notes.doc, budget.sheet, script.sh, config.toml"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Initial Content</label>
                <textarea
                  rows={8}
                  placeholder="# Enter script, JSON, Markdown, or text..."
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full p-3 bg-slate-950 text-emerald-300 font-mono text-xs rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFileModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-md"
                >
                  Create File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New Folder</h3>
            <p className="text-xs text-slate-500 mb-4">
              Create a new directory in {currentVfsPath}.
            </p>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. sprint_q3, analytics, docs"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmConfig && (
        <ConfirmModal
          isOpen={confirmConfig.isOpen}
          title={confirmConfig.title}
          message={confirmConfig.message}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirmConfig(null)}
        />
      )}
    </div>
  );
};
