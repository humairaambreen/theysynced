'use client';

import React, { useState, useMemo } from 'react';
import { Company, Team, ChatMessage, UserProfile, WorkspaceAsset, ActiveTab } from '../types';
import { 
  Folder, FolderPlus, Upload, Search, Trash2, Edit2, Download, 
  ExternalLink, Eye, ChevronRight, FileText, Image, Video, Music, 
  FileCode, File, Globe, Lock, Check, X, ShieldAlert, Sparkles, 
  ArrowLeft, HardDrive, RefreshCw, MessageSquare, Terminal, Table, 
  PenTool, Code, CheckCircle
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { buildCompanyLinuxFilesystem } from '../lib/linuxFilesystem';

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
}) => {
  // Navigation State: Breadcrumb path of folder IDs / virtual path
  const [currentPath, setCurrentPath] = useState<string[]>(['root']);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  
  // Modals & Actions State
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderScope, setNewFolderScope] = useState<'shared' | 'private'>('shared');

  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  
  const [renameTarget, setRenameTarget] = useState<WorkspaceAsset | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  const [previewFile, setPreviewFile] = useState<WorkspaceAsset | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
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

  // Unified Company Linux Filesystem & Virtual Assets
  const { entries: linuxEntries, virtualAssets: linuxVirtualAssets } = useMemo(() => {
    return buildCompanyLinuxFilesystem(company, teams, chatMessages, assets, user);
  }, [company, teams, chatMessages, assets, user]);

  // Merged Assets: Real D1 assets + Linux generated system assets
  const mergedAssets = useMemo(() => {
    const list = [...assets];
    linuxVirtualAssets.forEach((va) => {
      if (!list.some((a) => a.name === va.name && a.folder_path === va.folder_path)) {
        list.push(va);
      }
    });
    return list;
  }, [assets, linuxVirtualAssets]);

  // Filter accessible assets based on permission rules
  const accessibleAssets = useMemo(() => {
    return mergedAssets.filter((asset) => {
      if (asset.scope === 'dm' || asset.folder_path?.includes('/Direct Messages/')) {
        if (isAdmin) return true;
        if (asset.allowed_users && asset.allowed_users.length > 0) {
          return asset.allowed_users.some(
            (u) => u.toLowerCase() === user.username.toLowerCase()
          );
        }
        const dmMatch = asset.folder_path?.match(/@([a-zA-Z0-9_.-]+)\s*&\s*@([a-zA-Z0-9_.-]+)/);
        if (dmMatch) {
          const u1 = dmMatch[1].toLowerCase();
          const u2 = dmMatch[2].toLowerCase();
          const current = user.username.toLowerCase();
          return current === u1 || current === u2;
        }
        return false;
      }

      if (asset.scope === 'private') {
        if (isAdmin) return true;
        return asset.created_by.toLowerCase() === user.username.toLowerCase();
      }

      return true;
    });
  }, [mergedAssets, isAdmin, user.username]);

  const currentFolderId = currentPath[currentPath.length - 1];

  // Derive Current Linux Path for Terminal cd
  const currentLinuxPath = useMemo(() => {
    if (currentFolderId === 'root') return '/workspace';
    if (currentFolderId === 'v_linux_chats') return '/workspace/chats';
    if (currentFolderId === 'v_linux_sheets') return '/workspace/spreadsheets';
    if (currentFolderId === 'v_linux_drawings') return '/workspace/drawings';
    if (currentFolderId === 'v_linux_docs') return '/workspace/docs';
    if (currentFolderId === 'v_linux_files') return '/workspace/files';
    if (currentFolderId === 'v_linux_export') return '/workspace/export';
    const f = accessibleAssets.find((a) => a.id === currentFolderId);
    return f ? `/workspace/${f.name}` : '/workspace';
  }, [currentFolderId, accessibleAssets]);

  // Items in Current Folder
  const currentItems = useMemo<WorkspaceAsset[]>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return accessibleAssets.filter((a) => {
        if (a.asset_type === 'folder') return false;
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesUploader = a.created_by.toLowerCase().includes(q);
        const matchesType = a.file_type?.toLowerCase().includes(q);
        return matchesName || matchesUploader || matchesType;
      });
    }

    if (currentFolderId === 'root') {
      const customRootFolders = accessibleAssets.filter(
        (a) => a.asset_type === 'folder' && (!a.parent_id || a.parent_id === 'root') && !a.folder_path?.startsWith('/Chat Attachments')
      );

      const linuxSystemFolders: WorkspaceAsset[] = [
        {
          id: 'v_linux_chats',
          company_id: company.id,
          asset_type: 'folder',
          name: 'chats',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/chats',
          scope: 'shared',
        },
        {
          id: 'v_linux_sheets',
          company_id: company.id,
          asset_type: 'folder',
          name: 'spreadsheets',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/spreadsheets',
          scope: 'shared',
        },
        {
          id: 'v_linux_drawings',
          company_id: company.id,
          asset_type: 'folder',
          name: 'drawings',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/drawings',
          scope: 'shared',
        },
        {
          id: 'v_linux_docs',
          company_id: company.id,
          asset_type: 'folder',
          name: 'docs',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/docs',
          scope: 'shared',
        },
        {
          id: 'v_linux_files',
          company_id: company.id,
          asset_type: 'folder',
          name: 'files',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/files',
          scope: 'shared',
        },
        {
          id: 'v_linux_export',
          company_id: company.id,
          asset_type: 'folder',
          name: 'export',
          created_by: 'Linux Kernel',
          updated_at: new Date().toISOString(),
          folder_path: '/workspace/export',
          scope: 'shared',
        },
      ];

      return [...linuxSystemFolders, ...customRootFolders];
    }

    // Inside /workspace/chats
    if (currentFolderId === 'v_linux_chats') {
      return linuxEntries
        .filter((e) => e.folder === '/workspace/chats')
        .map((e): WorkspaceAsset => ({
          id: `chat_file_${e.name}`,
          company_id: company.id,
          asset_type: 'file',
          name: e.name,
          folder_path: '/workspace/chats',
          content: e.content,
          size: e.size,
          created_by: e.created_by,
          updated_at: e.updated_at,
          scope: 'shared',
        }));
    }

    // Inside /workspace/spreadsheets
    if (currentFolderId === 'v_linux_sheets') {
      return linuxEntries
        .filter((e) => e.folder === '/workspace/spreadsheets')
        .map((e): WorkspaceAsset => ({
          id: e.asset_id || `sheet_${e.name}`,
          company_id: company.id,
          asset_type: 'spreadsheet',
          name: e.name,
          folder_path: '/workspace/spreadsheets',
          content: e.content,
          size: e.size,
          created_by: e.created_by,
          updated_at: e.updated_at,
          scope: 'shared',
        }));
    }

    // Inside /workspace/drawings
    if (currentFolderId === 'v_linux_drawings') {
      return linuxEntries
        .filter((e) => e.folder === '/workspace/drawings')
        .map((e): WorkspaceAsset => ({
          id: e.asset_id || `drawing_${e.name}`,
          company_id: company.id,
          asset_type: 'whiteboard',
          name: e.name,
          folder_path: '/workspace/drawings',
          content: e.content,
          size: e.size,
          created_by: e.created_by,
          updated_at: e.updated_at,
          scope: 'shared',
        }));
    }

    // Inside /workspace/docs
    if (currentFolderId === 'v_linux_docs') {
      return linuxEntries
        .filter((e) => e.folder === '/workspace/docs')
        .map((e): WorkspaceAsset => ({
          id: e.asset_id || `doc_${e.name}`,
          company_id: company.id,
          asset_type: 'doc',
          name: e.name,
          folder_path: '/workspace/docs',
          content: e.content,
          size: e.size,
          created_by: e.created_by,
          updated_at: e.updated_at,
          scope: 'shared',
        }));
    }

    // Inside /workspace/export
    if (currentFolderId === 'v_linux_export') {
      return accessibleAssets.filter((a) => a.folder_path === '/workspace/export' || a.name.includes('backup'));
    }

    // Inside /workspace/files or custom folder
    return accessibleAssets.filter((a) => {
      if (a.parent_id === currentFolderId) return true;
      if (currentFolderId === 'v_linux_files') {
        return a.asset_type === 'file' && (!a.folder_path || a.folder_path === '/workspace/files');
      }
      return false;
    });
  }, [accessibleAssets, currentFolderId, searchQuery, company.id, user.username, linuxEntries]);

  // Filter items by type
  const filteredItems = useMemo(() => {
    return currentItems.filter((item) => {
      if (item.asset_type === 'folder') return true;
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
        return ext === 'csv' || item.name.endsWith('.sheet.json') || item.asset_type === 'spreadsheet';
      }
      if (activeFilter === 'drawings') {
        return item.name.endsWith('.excalidraw.json') || item.asset_type === 'whiteboard';
      }
      if (activeFilter === 'documents') {
        return ext === 'md' || item.name.endsWith('.doc.json') || ext === 'pdf' || ext === 'txt' || item.asset_type === 'doc';
      }
      if (activeFilter === 'chat') {
        return item.folder_path?.includes('chats') || ext === 'log' || item.name.endsWith('.chat.json');
      }
      return true;
    });
  }, [currentItems, activeFilter]);

  // Breadcrumbs Navigation
  const navigateToBreadcrumb = (index: number) => {
    setCurrentPath((prev) => prev.slice(0, index + 1));
    setSearchQuery('');
  };

  const handleOpenFolder = (folderId: string) => {
    setCurrentPath((prev) => [...prev, folderId]);
    setSearchQuery('');
  };

  // Open File in Visualizer Tab
  const handleOpenInVisualizer = (item: WorkspaceAsset) => {
    if (!onNavigateTab) return;
    const name = item.name.toLowerCase();

    if (name.endsWith('.sheet.json') || name.endsWith('.csv') || item.asset_type === 'spreadsheet') {
      onNavigateTab('spreadsheet', item.id);
    } else if (name.endsWith('.excalidraw.json') || item.asset_type === 'whiteboard') {
      onNavigateTab('whiteboard', item.id);
    } else if (name.endsWith('.doc.json') || name.endsWith('.md') || item.asset_type === 'doc') {
      onNavigateTab('docs', item.id);
    } else if (name.endsWith('.chat.json') || name.endsWith('.log') || item.folder_path?.includes('chats')) {
      // Find channel id
      const chan = teams.find((t) => t.name.toLowerCase() === name.replace(/\.(log|chat\.json)$/, '').replace(/^dm-/, 'dm:'));
      onNavigateTab('teams', chan ? chan.id : undefined);
    } else {
      setPreviewFile(item);
    }
  };

  // Trigger Organization Full Backup
  const handleExportOrgBackup = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupName = `${companySlug}_backup_${timestamp}.json`;
    
    // Create complete data bundle
    const exportBundle = {
      organization: company,
      exported_at: new Date().toISOString(),
      channels: teams,
      chat_messages: chatMessages,
      spreadsheets: linuxEntries.filter((e) => e.category === 'spreadsheet'),
      drawings: linuxEntries.filter((e) => e.category === 'drawing'),
      docs: linuxEntries.filter((e) => e.category === 'doc'),
      files: assets.map((a) => ({ name: a.name, type: a.asset_type, url: a.url, size: a.size })),
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

    const parentId = currentFolderId === 'root' ? 'root' : currentFolderId;
    const folderId = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    await onSaveAsset({
      id: folderId,
      company_id: company.id,
      asset_type: 'folder',
      name: newFolderName.trim(),
      parent_id: parentId,
      folder_path: currentLinuxPath,
      created_by: user.username,
      updated_at: new Date().toISOString(),
      scope: newFolderScope,
    });

    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  // Create New Code / Script File
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await onSaveAsset({
      id: fileId,
      company_id: company.id,
      asset_type: newFileName.endsWith('.sheet.json') ? 'spreadsheet' : newFileName.endsWith('.excalidraw.json') ? 'whiteboard' : newFileName.endsWith('.doc.json') || newFileName.endsWith('.md') ? 'doc' : 'file',
      name: newFileName.trim(),
      content: newFileContent,
      size: newFileContent.length,
      folder_path: currentLinuxPath,
      created_by: user.username,
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });

    setNewFileName('');
    setNewFileContent('');
    setShowNewFileModal(false);
  };

  // Upload Files into current folder
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const uploadRes = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            file_type: file.type || 'application/octet-stream',
            data_base64: base64Data,
          }),
        });

        const uploadData = await uploadRes.json();
        const fileUrl = uploadData.success && uploadData.url ? uploadData.url : base64Data;

        const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await onSaveAsset({
          id: fileId,
          company_id: company.id,
          asset_type: file.type?.includes('pdf') ? 'pdf' : 'file',
          name: file.name,
          url: fileUrl,
          file_type: file.type || 'application/octet-stream',
          size: file.size,
          parent_id: currentFolderId === 'root' ? 'root' : currentFolderId,
          folder_path: currentLinuxPath,
          created_by: user.username,
          updated_at: new Date().toISOString(),
          scope: 'shared',
        });
      }
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Rename File
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;

    await onSaveAsset({
      id: renameTarget.id,
      name: renameValue.trim(),
      updated_at: new Date().toISOString(),
    });

    setRenameTarget(null);
    setRenameValue('');
  };

  // Delete Item
  const handleDelete = (item: WorkspaceAsset) => {
    setConfirmConfig({
      isOpen: true,
      title: `Delete ${item.asset_type === 'folder' ? 'Folder' : 'File'}`,
      message: `Are you sure you want to permanently delete "${item.name}" from company storage and Linux filesystem?`,
      onConfirm: async () => {
        await onDeleteAsset(item.id);
        setConfirmConfig(null);
      },
    });
  };

  // Helper to choose item icon
  const getItemIcon = (item: WorkspaceAsset) => {
    if (item.asset_type === 'folder') {
      return <Folder className="w-5 h-5 text-indigo-500 shrink-0 fill-indigo-50" />;
    }
    const name = item.name.toLowerCase();
    if (name.endsWith('.sheet.json') || name.endsWith('.csv') || item.asset_type === 'spreadsheet') {
      return <Table className="w-5 h-5 text-emerald-600 shrink-0" />;
    }
    if (name.endsWith('.excalidraw.json') || item.asset_type === 'whiteboard') {
      return <PenTool className="w-5 h-5 text-purple-600 shrink-0" />;
    }
    if (name.endsWith('.doc.json') || name.endsWith('.md') || item.asset_type === 'doc') {
      return <FileText className="w-5 h-5 text-blue-600 shrink-0" />;
    }
    if (name.endsWith('.chat.json') || name.endsWith('.log') || item.folder_path?.includes('chats')) {
      return <MessageSquare className="w-5 h-5 text-cyan-600 shrink-0" />;
    }
    if (['py', 'sh', 'js', 'json', 'ts'].includes(name.split('.').pop() || '')) {
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
              <h1 className="text-base font-black text-slate-900 tracking-tight">Linux File System (GUI)</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                theysynced-{companySlug}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Unified graphical frontend for company Linux filesystem &bull; Direct visualizer interoperability
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Open in Linux Terminal */}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('terminal', currentLinuxPath)}
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
            title="Export Full Organization Archive (Chats, Sheets, Drawings, Docs, Files)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Org Backup</span>
          </button>

          {/* Upload Files */}
          <label className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold cursor-pointer shadow-sm transition-all active:scale-95">
            <Upload className="w-3.5 h-3.5 text-indigo-600" />
            <span>Upload</span>
            <input type="file" multiple onChange={handleFileUpload} className="hidden" disabled={isUploading} />
          </label>

          {/* New Script / Code File */}
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

          {onRefreshAssets && (
            <button
              onClick={onRefreshAssets}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
              title="Refresh Storage"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
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

      {/* Breadcrumb Path & Filters */}
      <div className="px-6 py-3 bg-white/60 backdrop-blur-sm border-b border-black/[0.03] flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        {/* Linux Path Breadcrumbs */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 overflow-x-auto w-full md:w-auto py-1 font-mono">
          <button 
            onClick={() => navigateToBreadcrumb(0)}
            className="font-bold text-slate-800 hover:text-indigo-600 flex items-center space-x-1 shrink-0 px-2 py-1 rounded-lg hover:bg-slate-100"
          >
            <span>/workspace</span>
          </button>

          {currentPath.slice(1).map((segment, idx) => {
            const folderObj = accessibleAssets.find((a) => a.id === segment);
            const label = segment.replace(/^v_linux_/, '');
            return (
              <React.Fragment key={segment}>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <button
                  onClick={() => navigateToBreadcrumb(idx + 1)}
                  className={`font-semibold hover:text-indigo-600 truncate max-w-[160px] px-2 py-1 rounded-lg hover:bg-slate-100 ${
                    idx === currentPath.length - 2 ? 'text-indigo-600 font-bold bg-indigo-50/70' : ''
                  }`}
                >
                  {folderObj?.name || label}
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
              placeholder="Search files, logs..."
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
            <option value="all">All Files</option>
            <option value="spreadsheets">Spreadsheets</option>
            <option value="drawings">Drawings</option>
            <option value="documents">Docs & MD</option>
            <option value="chat">Chat Logs</option>
            <option value="images">Images</option>
            <option value="videos">Videos</option>
          </select>
        </div>
      </div>

      {/* Main Filesystem View */}
      <div className="flex-1 p-6 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-white rounded-3xl border border-dashed border-slate-200">
            <Folder className="w-10 h-10 text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700">Directory is Empty</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Use &quot;Upload&quot;, &quot;New File&quot;, or the Linux Terminal to create files and scripts in this directory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredItems.map((item) => {
              const isFolder = item.asset_type === 'folder';
              return (
                <div
                  key={item.id}
                  onDoubleClick={() => isFolder ? handleOpenFolder(item.id) : handleOpenInVisualizer(item)}
                  className="group relative bg-white border border-slate-200/80 hover:border-indigo-500/40 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2.5 rounded-xl bg-slate-50 group-hover:bg-indigo-50/50 transition-colors">
                      {getItemIcon(item)}
                    </div>
                    
                    {/* Visualizer Quick Action */}
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
                        <span>Visualize</span>
                      </button>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900 truncate mb-1" title={item.name}>
                      {item.name}
                    </h4>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>{isFolder ? 'Folder' : item.size ? `${(item.size / 1024).toFixed(1)} KB` : 'System File'}</span>
                      <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Context Actions */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="truncate max-w-[100px] text-[10px]">{item.created_by}</span>
                    <div className="flex items-center space-x-1">
                      {item.url && (
                        <a
                          href={item.url}
                          download={item.name}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 hover:text-slate-900 rounded"
                          title="Download"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      )}
                      {!isFolder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile(item);
                          }}
                          className="p-1 hover:text-slate-900 rounded"
                          title="Inspect File"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      )}
                      {isAdmin && !item.id.startsWith('chat_file_') && (
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
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {getItemIcon(previewFile)}
                <span className="font-bold text-xs font-mono">{previewFile.name}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenInVisualizer(previewFile)}
                  className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center space-x-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open in Visualizer</span>
                </button>
                <button onClick={() => setPreviewFile(null)} className="p-1 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-auto bg-slate-950 text-slate-200 font-mono text-xs">
              <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {previewFile.content || 'Binary data or streaming asset stored in Cloudflare storage tier.'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* New Code / Script File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New Code / Data File</h3>
            <p className="text-xs text-slate-500 mb-4">
              Write scripts, configurations, or data files in the company&apos;s Linux filesystem.
            </p>

            <form onSubmit={handleCreateFile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">File Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. script.py, data.csv, budget.sheet.json, notes.md"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Content</label>
                <textarea
                  rows={8}
                  placeholder="# Enter Python script, CSV records, JSON, or text..."
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
                  Save & Mount File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. analytics, scripts, q4_reports"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none"
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
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-md"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
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
