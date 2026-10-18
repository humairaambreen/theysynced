'use client';

import React, { useState, useMemo } from 'react';
import { Company, UserProfile, WorkspaceAsset } from '../types';
import { 
  Folder, FolderPlus, Upload, Search, Trash2, Edit2, Download, 
  ExternalLink, Eye, ChevronRight, FileText, Image, Video, Music, 
  FileCode, File, Globe, Lock, Check, X, ShieldAlert, Sparkles, 
  ArrowLeft, HardDrive, RefreshCw, MessageSquare
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

interface SharedAssetsViewProps {
  user: UserProfile;
  company: Company;
  assets: WorkspaceAsset[];
  onSaveAsset: (asset: Partial<WorkspaceAsset>) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onRefreshAssets?: () => void;
}

type FilterType = 'all' | 'images' | 'videos' | 'audio' | 'documents' | 'chat';

export const SharedAssetsView: React.FC<SharedAssetsViewProps> = ({
  user,
  company,
  assets,
  onSaveAsset,
  onDeleteAsset,
  onRefreshAssets,
}) => {
  // Navigation State: Breadcrumb path of folder IDs / virtual path
  const [currentPath, setCurrentPath] = useState<string[]>(['root']);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  
  // Modals & Actions State
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderScope, setNewFolderScope] = useState<'shared' | 'private'>('shared');
  
  const [renameTarget, setRenameTarget] = useState<WorkspaceAsset | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  const [previewFile, setPreviewFile] = useState<WorkspaceAsset | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Confirm Modal Config
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Determine if current user is admin or owner
  const isAdmin = useMemo(() => {
    if (company.owner_id === user.id) return true;
    return (company.members || []).some(
      (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
    );
  }, [company, user.id]);

  // Filter accessible assets based on permission & scoping rules
  const accessibleAssets = useMemo(() => {
    return assets.filter((asset) => {
      // 1. If it's a DM asset (e.g. chat files or DM folder)
      if (asset.scope === 'dm' || asset.folder_path?.includes('/Direct Messages/')) {
        if (isAdmin) return true; // Admins have full platform visibility
        if (asset.allowed_users && asset.allowed_users.length > 0) {
          return asset.allowed_users.some(
            (u) => u.toLowerCase() === user.username.toLowerCase()
          );
        }
        // Try parsing usernames from folder_path e.g. /Chat Attachments/Direct Messages/@aryan & @humaira
        const dmMatch = asset.folder_path?.match(/@([a-zA-Z0-9_.-]+)\s*&\s*@([a-zA-Z0-9_.-]+)/);
        if (dmMatch) {
          const u1 = dmMatch[1].toLowerCase();
          const u2 = dmMatch[2].toLowerCase();
          const current = user.username.toLowerCase();
          return current === u1 || current === u2;
        }
        return false;
      }

      // 2. If it's private to a specific user
      if (asset.scope === 'private') {
        if (isAdmin) return true;
        return asset.created_by.toLowerCase() === user.username.toLowerCase();
      }

      // 3. Otherwise it's shared across the company
      return true;
    });
  }, [assets, isAdmin, user.username]);

  // Construct Virtual & Stored Folder Tree
  const currentFolderId = currentPath[currentPath.length - 1];

  // Helper to get items in the current folder
  const currentItems = useMemo<WorkspaceAsset[]>(() => {
    // If user is searching, return matching files across all accessible assets
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

      const virtualFolders: WorkspaceAsset[] = [
        {
          id: 'v_chat_attachments',
          company_id: company.id,
          asset_type: 'folder',
          name: 'Chat Attachments',
          created_by: 'System',
          updated_at: new Date().toISOString(),
          folder_path: '/Chat Attachments',
          scope: 'shared',
        },
        {
          id: 'v_company_shared',
          company_id: company.id,
          asset_type: 'folder',
          name: 'Company Shared Files',
          created_by: 'System',
          updated_at: new Date().toISOString(),
          folder_path: '/Company Shared Files',
          scope: 'shared',
        },
        {
          id: 'v_my_private',
          company_id: company.id,
          asset_type: 'folder',
          name: 'My Private Files',
          created_by: user.username,
          updated_at: new Date().toISOString(),
          folder_path: `/Users/${user.username}`,
          scope: 'private',
        },
      ];

      return [...virtualFolders, ...customRootFolders];
    }

    if (currentFolderId === 'v_chat_attachments') {
      // Show Chat channels and Direct Messages virtual folder
      const channelSet = new Set<string>();
      let hasDMs = false;

      accessibleAssets.forEach((a) => {
        if (a.folder_path?.startsWith('/Chat Attachments/')) {
          const sub = a.folder_path.replace('/Chat Attachments/', '').split('/')[0];
          if (sub === 'Direct Messages') {
            hasDMs = true;
          } else if (sub) {
            channelSet.add(sub);
          }
        }
      });

      const list: WorkspaceAsset[] = [];
      channelSet.forEach((chan) => {
        list.push({
          id: `v_chat_${chan}`,
          company_id: company.id,
          asset_type: 'folder',
          name: chan,
          created_by: 'Chat Bot',
          updated_at: new Date().toISOString(),
          folder_path: `/Chat Attachments/${chan}`,
          scope: 'shared',
        });
      });

      if (hasDMs) {
        list.push({
          id: 'v_chat_dms',
          company_id: company.id,
          asset_type: 'folder',
          name: 'Direct Messages',
          created_by: 'System',
          updated_at: new Date().toISOString(),
          folder_path: '/Chat Attachments/Direct Messages',
          scope: 'dm',
        });
      }

      return list;
    }

    if (currentFolderId === 'v_chat_dms') {
      // List all DM conversations where current user is participant (or admin)
      const dmSet = new Set<string>();
      accessibleAssets.forEach((a) => {
        if (a.folder_path?.startsWith('/Chat Attachments/Direct Messages/')) {
          const dmName = a.folder_path.replace('/Chat Attachments/Direct Messages/', '').split('/')[0];
          if (dmName) dmSet.add(dmName);
        }
      });

      return Array.from(dmSet).map((dmName): WorkspaceAsset => ({
        id: `v_dm_${dmName}`,
        company_id: company.id,
        asset_type: 'folder',
        name: dmName,
        created_by: 'System',
        updated_at: new Date().toISOString(),
        folder_path: `/Chat Attachments/Direct Messages/${dmName}`,
        scope: 'dm',
      }));
    }

    // Inside a specific folder: find child folders and child files
    return accessibleAssets.filter((a) => {
      // Matched by explicit parent_id
      if (a.parent_id === currentFolderId || a.folder_id === currentFolderId) return true;

      // Or matched by virtual path prefix
      if (currentFolderId.startsWith('v_chat_') || currentFolderId.startsWith('v_dm_')) {
        const folderAsset = accessibleAssets.find((x) => x.id === currentFolderId) || {
          folder_path: currentFolderId === 'v_company_shared' ? '/Company Shared Files' :
                       currentFolderId === 'v_my_private' ? `/Users/${user.username}` :
                       currentFolderId.startsWith('v_dm_') ? `/Chat Attachments/Direct Messages/${currentFolderId.replace('v_dm_', '')}` :
                       `/Chat Attachments/${currentFolderId.replace('v_chat_', '')}`
        };
        if (a.folder_path === folderAsset.folder_path) return true;
      }

      if (currentFolderId === 'v_company_shared') {
        return a.parent_id === 'v_company_shared' || (a.scope === 'shared' && a.parent_id === 'root' && a.asset_type === 'folder');
      }

      if (currentFolderId === 'v_my_private') {
        return a.parent_id === 'v_my_private' || (a.scope === 'private' && a.parent_id === 'root' && a.created_by === user.username);
      }

      return false;
    });
  }, [accessibleAssets, currentFolderId, searchQuery, company.id, user.username]);

  // Filter items by type (images, videos, etc.)
  const filteredItems = useMemo(() => {
    return currentItems.filter((item) => {
      if (item.asset_type === 'folder') return true; // always show folders
      if (activeFilter === 'all') return true;
      const type = (item.file_type || '').toLowerCase();
      const ext = item.name.split('.').pop()?.toLowerCase() || '';

      if (activeFilter === 'images') {
        return type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      }
      if (activeFilter === 'videos') {
        return type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext);
      }
      if (activeFilter === 'audio') {
        return type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext);
      }
      if (activeFilter === 'documents') {
        return type.includes('pdf') || type.includes('document') || type.includes('text') || ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx'].includes(ext);
      }
      if (activeFilter === 'chat') {
        return item.folder_path?.startsWith('/Chat Attachments');
      }
      return true;
    });
  }, [currentItems, activeFilter]);

  // Handle Breadcrumb clicks
  const navigateToBreadcrumb = (index: number) => {
    setCurrentPath((prev) => prev.slice(0, index + 1));
    setSearchQuery('');
  };

  // Open a folder
  const handleOpenFolder = (folderId: string) => {
    setCurrentPath((prev) => [...prev, folderId]);
    setSearchQuery('');
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
      created_by: user.username,
      updated_at: new Date().toISOString(),
      scope: newFolderScope,
    });

    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  // Handle File Upload into current folder
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // 1. Read as Base64 for Cloudflare Storage API
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // 2. Upload to Cloudflare storage endpoint
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

        // 3. Save asset record to D1
        const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const scope = currentFolderId.includes('private') ? 'private' : 'shared';

        await onSaveAsset({
          id: fileId,
          company_id: company.id,
          asset_type: 'file',
          name: file.name,
          url: fileUrl,
          file_type: file.type || 'application/octet-stream',
          size: file.size,
          parent_id: currentFolderId,
          folder_id: currentFolderId,
          created_by: user.username,
          updated_at: new Date().toISOString(),
          scope: scope,
        });
      }
    } catch (err: any) {
      console.error('File upload error:', err);
      setUploadError(err.message || 'Failed to upload file.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Rename asset or folder
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;

    await onSaveAsset({
      id: renameTarget.id,
      company_id: company.id,
      name: renameValue.trim(),
      updated_at: new Date().toISOString(),
    });

    setRenameTarget(null);
    setRenameValue('');
  };

  // Delete asset or folder
  const handleDeleteItem = (item: WorkspaceAsset) => {
    const isFolder = item.asset_type === 'folder';
    setConfirmConfig({
      isOpen: true,
      title: `Delete ${isFolder ? 'Folder' : 'File'}`,
      message: `Are you sure you want to delete "${item.name}"? ${
        isFolder ? 'All sub-folders and files inside will also be removed.' : 'This action cannot be undone.'
      }`,
      onConfirm: async () => {
        await onDeleteAsset(item.id);
        setConfirmConfig(null);
      },
    });
  };

  // Copy shareable link to clipboard
  const handleCopyLink = (url?: string) => {
    if (!url) return;
    const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  // Human readable file size formatter
  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Icon helper based on file type
  const getFileIcon = (item: WorkspaceAsset) => {
    if (item.asset_type === 'folder') {
      return <Folder className="w-8 h-8 text-amber-500 fill-amber-100" />;
    }
    const type = (item.file_type || '').toLowerCase();
    const ext = item.name.split('.').pop()?.toLowerCase() || '';

    if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      return <Image className="w-8 h-8 text-indigo-500" />;
    }
    if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
      return <Video className="w-8 h-8 text-rose-500" />;
    }
    if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      return <Music className="w-8 h-8 text-emerald-500" />;
    }
    if (type.includes('pdf') || ext === 'pdf') {
      return <FileText className="w-8 h-8 text-red-600" />;
    }
    if (['json', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'rs', 'py'].includes(ext)) {
      return <FileCode className="w-8 h-8 text-cyan-600" />;
    }
    return <File className="w-8 h-8 text-slate-400" />;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F8F9FB] select-none overflow-hidden">
      
      {/* Top Header Bar */}
      <header className="px-6 py-5 bg-white border-b border-black/[0.05] flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-sm">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 tracking-tight">Shared Assets & Cloud Storage</h1>
              <p className="text-xs text-slate-500">
                Encrypted edge storage with nested folders, chat attachments, and granular access controls.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center space-x-2.5">
          <label className="flex items-center space-x-2 px-4 py-2 bg-slate-950 text-white hover:bg-slate-800 text-xs font-bold rounded-xl cursor-pointer shadow-md transition-all active:scale-95">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Files</span>
            <input 
              type="file" 
              multiple 
              onChange={handleFileUpload} 
              className="hidden" 
              disabled={isUploading}
            />
          </label>

          <button
            onClick={() => setShowNewFolderModal(true)}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl shadow-sm transition-all active:scale-95"
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

      {/* Filter and Search Bar */}
      <div className="px-6 py-3.5 bg-white/70 backdrop-blur-sm border-b border-black/[0.03] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        
        {/* Breadcrumb Path */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-600 overflow-x-auto w-full sm:w-auto py-1">
          <button 
            onClick={() => navigateToBreadcrumb(0)}
            className="font-bold hover:text-indigo-600 flex items-center space-x-1 shrink-0 px-1.5 py-1 rounded-lg hover:bg-slate-100"
          >
            <span>All Assets</span>
          </button>

          {currentPath.slice(1).map((segment, idx) => {
            const label = segment.startsWith('v_chat_') ? `#${segment.replace('v_chat_', '')}` :
                          segment === 'v_chat_attachments' ? 'Chat Attachments' :
                          segment === 'v_chat_dms' ? 'Direct Messages' :
                          segment === 'v_company_shared' ? 'Company Shared' :
                          segment === 'v_my_private' ? 'My Private' :
                          segment.startsWith('v_dm_') ? segment.replace('v_dm_', '') :
                          accessibleAssets.find((a) => a.id === segment)?.name || segment;

            return (
              <React.Fragment key={segment}>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <button
                  onClick={() => navigateToBreadcrumb(idx + 1)}
                  className={`font-semibold hover:text-indigo-600 truncate max-w-[150px] px-1.5 py-1 rounded-lg hover:bg-slate-100 ${
                    idx === currentPath.length - 2 ? 'text-indigo-600 font-bold bg-indigo-50/60' : ''
                  }`}
                >
                  {label}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Search & Media Filter Controls */}
        <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search files, extensions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100/70 border border-slate-200/80 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="hidden md:flex items-center bg-slate-100/80 p-1 rounded-xl text-[11px] font-semibold text-slate-600">
            {(['all', 'images', 'videos', 'audio', 'documents', 'chat'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-all ${
                  activeFilter === f ? 'bg-white text-indigo-600 shadow-sm font-bold' : 'hover:text-slate-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Uploading Progress Indicator */}
      {isUploading && (
        <div className="px-6 py-2 bg-indigo-50 text-indigo-700 text-xs font-semibold flex items-center justify-between border-b border-indigo-100 animate-pulse">
          <div className="flex items-center space-x-2">
            <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span>Encrypting and uploading files to Cloudflare edge storage...</span>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {uploadError && (
        <div className="px-6 py-2 bg-rose-50 text-rose-700 text-xs font-semibold flex items-center justify-between border-b border-rose-100">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Main Explorer Content Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
            <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-4">
              <Folder className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-bold text-slate-700 mb-1">No items found</h3>
            <p className="text-xs max-w-sm text-slate-400 mb-5">
              {searchQuery 
                ? 'No files matched your search query in this folder.' 
                : 'This folder is empty. Upload files or create sub-folders to start organizing.'}
            </p>
            <div className="flex items-center space-x-3">
              <label className="flex items-center space-x-2 px-4 py-2 bg-slate-950 text-white hover:bg-slate-800 text-xs font-bold rounded-xl cursor-pointer shadow-sm">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload File</span>
                <input type="file" multiple onChange={handleFileUpload} className="hidden" />
              </label>
              <button
                onClick={() => setShowNewFolderModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl"
              >
                <FolderPlus className="w-3.5 h-3.5 text-indigo-600" />
                <span>Create Sub-folder</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredItems.map((item) => {
              const isFolder = item.asset_type === 'folder';
              const isDM = item.scope === 'dm' || item.folder_path?.includes('/Direct Messages/');
              const isPrivate = item.scope === 'private';
              const isVirtual = item.id.startsWith('v_');

              return (
                <div
                  key={item.id}
                  className={`group relative bg-white border border-slate-200/80 rounded-2xl p-4 transition-all hover:shadow-md hover:border-slate-300 flex flex-col justify-between ${
                    isFolder ? 'cursor-pointer hover:bg-indigo-50/20' : ''
                  }`}
                  onClick={() => {
                    if (isFolder) handleOpenFolder(item.id);
                    else setPreviewFile(item);
                  }}
                >
                  {/* Top Header of Card */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="relative">
                      {getFileIcon(item)}
                      {isPrivate && (
                        <span className="absolute -top-1 -right-1 p-0.5 bg-emerald-500 text-white rounded-full" title="Private to you">
                          <Lock className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {isDM && (
                        <span className="absolute -top-1 -right-1 p-0.5 bg-rose-500 text-white rounded-full" title="Direct Message (Limited)">
                          <MessageSquare className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>

                    {/* Action Menu (Rename, Delete, Copy Link) */}
                    <div 
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isFolder && item.url && (
                        <button
                          onClick={() => handleCopyLink(item.url)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Copy Shareable Link"
                        >
                          {copiedLink === item.url ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <ExternalLink className="w-3.5 h-3.5" />}
                        </button>
                      )}

                      {!isVirtual && (
                        <>
                          <button
                            onClick={() => {
                              setRenameTarget(item);
                              setRenameValue(item.name);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-800 truncate mb-1" title={item.name}>
                      {item.name}
                    </h4>

                    <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                      {isFolder ? (
                        <span>Folder</span>
                      ) : (
                        <>
                          <span>{formatFileSize(item.size)}</span>
                          <span>•</span>
                          <span className="truncate">@{item.created_by}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Bottom Footer Tags */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400 truncate">
                      {new Date(item.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>

                    {isDM ? (
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-600 font-extrabold rounded-md text-[9px]">
                        DM Limited
                      </span>
                    ) : isPrivate ? (
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 font-extrabold rounded-md text-[9px]">
                        Private
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-500 font-bold rounded-md text-[9px]">
                        Shared
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Media Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/20 animate-scale-up">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  {getFileIcon(previewFile)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">{previewFile.name}</h3>
                  <p className="text-xs text-slate-400">
                    {formatFileSize(previewFile.size)} • Uploaded by @{previewFile.created_by} on {new Date(previewFile.updated_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {previewFile.url && (
                  <>
                    <button
                      onClick={() => handleCopyLink(previewFile.url)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
                    >
                      {copiedLink === previewFile.url ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <ExternalLink className="w-3.5 h-3.5" />}
                      <span>{copiedLink === previewFile.url ? 'Copied!' : 'Copy Link'}</span>
                    </button>

                    <a
                      href={previewFile.url}
                      download={previewFile.name}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-950 text-white hover:bg-slate-800 text-xs font-bold rounded-xl shadow-sm transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  </>
                )}

                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / Viewer */}
            <div className="flex-1 bg-slate-900/5 p-6 overflow-y-auto flex items-center justify-center min-h-[350px]">
              {(() => {
                const type = (previewFile.file_type || '').toLowerCase();
                const ext = previewFile.name.split('.').pop()?.toLowerCase() || '';

                // 1. Image Preview
                if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
                  return (
                    <img
                      src={previewFile.url}
                      alt={previewFile.name}
                      className="max-h-[65vh] max-w-full object-contain rounded-2xl shadow-lg border border-black/10"
                    />
                  );
                }

                // 2. Video Preview
                if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
                  return (
                    <video
                      controls
                      autoPlay
                      src={previewFile.url}
                      className="max-h-[65vh] max-w-full rounded-2xl shadow-lg"
                    >
                      Your browser does not support the video tag.
                    </video>
                  );
                }

                // 3. Audio Preview
                if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
                  return (
                    <div className="w-full max-w-md p-8 bg-white rounded-3xl shadow-lg border border-slate-100 flex flex-col items-center text-center">
                      <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                        <Music className="w-8 h-8" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 mb-4">{previewFile.name}</h4>
                      <audio controls autoPlay src={previewFile.url} className="w-full">
                        Your browser does not support the audio tag.
                      </audio>
                    </div>
                  );
                }

                // 4. PDF Preview
                if (type.includes('pdf') || ext === 'pdf') {
                  return (
                    <iframe
                      src={previewFile.url}
                      title={previewFile.name}
                      className="w-full h-[65vh] rounded-2xl border border-slate-200 bg-white shadow-sm"
                    />
                  );
                }

                // 5. Code / Text File Preview
                if (['json', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'rs', 'py', 'txt', 'md', 'csv'].includes(ext)) {
                  return (
                    <div className="w-full max-w-3xl h-[60vh] bg-slate-950 text-slate-200 p-6 rounded-2xl font-mono text-xs overflow-auto">
                      <pre>{previewFile.content || 'Binary data or streaming content from Cloudflare edge.'}</pre>
                    </div>
                  );
                }

                // 6. Generic Fallback
                return (
                  <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm max-w-md">
                    <File className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                    <h4 className="text-sm font-bold text-slate-800 mb-1">{previewFile.name}</h4>
                    <p className="text-xs text-slate-400 mb-4">
                      Preview not supported inline for this file type. Download to inspect locally.
                    </p>
                    <a
                      href={previewFile.url}
                      download={previewFile.name}
                      className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download File</span>
                    </a>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New Folder</h3>
            <p className="text-xs text-slate-500 mb-4">
              Organize assets inside this folder. Choose whether it is shared or private.
            </p>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Design Assets, Q3 Invoices, Sprint Recordings"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Privacy Scope</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewFolderScope('shared')}
                    className={`p-3 rounded-xl border text-left flex flex-col transition-all ${
                      newFolderScope === 'shared' 
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900' 
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs mb-1">
                      <Globe className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Company Shared</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Accessible by all members</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewFolderScope('private')}
                    className={`p-3 rounded-xl border text-left flex flex-col transition-all ${
                      newFolderScope === 'private' 
                        ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900' 
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs mb-1">
                      <Lock className="w-3.5 h-3.5 text-emerald-600" />
                      <span>My Private</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Only visible to you & admin</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-950 text-white rounded-xl text-xs font-bold hover:bg-slate-800 shadow-sm"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Rename {renameTarget.asset_type}</h3>
            <form onSubmit={handleRenameSubmit} className="space-y-4 mt-3">
              <input
                type="text"
                required
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
                autoFocus
              />
              <div className="flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-950 text-white rounded-xl text-xs font-bold hover:bg-slate-800"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
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
