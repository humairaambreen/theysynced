'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Hash, FileText, Table, MessageSquare, User, X, ArrowRight, PenTool, Monitor, CheckSquare, FolderGit2, Terminal, Globe } from 'lucide-react';

import Fuse from 'fuse.js';
import { Company, Team, CompanyMember, WorkspaceAsset, ChatMessage } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  company: Company | null;
  teams: Team[];
  assets: WorkspaceAsset[];
  chatMessages: ChatMessage[];
  onNavigate: (tab: string, targetId?: string, targetUsername?: string) => void;
}

interface SearchItem {
  id: string;
  type: 'tab' | 'team' | 'member' | 'asset' | 'message';
  label: string;
  sublabel?: string;
  category: string;
  tab: string;
  teamId?: string;
  memberUsername?: string;
  assetType?: string;
  icon: React.FC<{ className?: string }>;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  company,
  teams,
  assets,
  chatMessages,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open handled by parent
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Build the searchable items list
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // 1. Navigation Tabs
    items.push(
      { id: 'tab-overview', type: 'tab', label: 'Office Perks & Company Info', category: 'Workspace navigation', tab: 'overview', icon: Hash },
      { id: 'tab-teams', type: 'tab', label: 'Teams & Channels Hub', category: 'Workspace navigation', tab: 'teams', icon: MessageSquare },
      { id: 'tab-tasks', type: 'tab', label: 'Jira Tasks Kanban Board', category: 'Workspace navigation', tab: 'tasks', icon: CheckSquare },
      { id: 'tab-assets', type: 'tab', label: 'Linux File System (GUI)', category: 'Workspace navigation', tab: 'assets', icon: FolderGit2 },
      { id: 'tab-terminal', type: 'tab', label: 'Linux Shell Terminal', category: 'Workspace navigation', tab: 'terminal', icon: Terminal },
      { id: 'tab-browser', type: 'tab', label: 'Web Browser & Localhost Dev Inspector', category: 'Workspace navigation', tab: 'browser', icon: Globe },
      { id: 'tab-rdp', type: 'tab', label: 'Remote Desktop (RDP)', category: 'Workspace navigation', tab: 'rdp', icon: Monitor },
      { id: 'tab-whiteboard', type: 'tab', label: 'Excalidraw Vector Board', category: 'Workspace navigation', tab: 'whiteboard', icon: PenTool },
      { id: 'tab-spreadsheet', type: 'tab', label: 'Statistical spreadsheet Grid', category: 'Workspace navigation', tab: 'spreadsheet', icon: Table },
      { id: 'tab-docs', type: 'tab', label: 'TipTap Docs & Knowledge Base', category: 'Workspace navigation', tab: 'docs', icon: FileText },
      { id: 'tab-activity', type: 'tab', label: 'Activity Hub & Governance', category: 'Workspace navigation', tab: 'activity', icon: Hash }
    );

    // 2. Company Teams & Channels
    teams.forEach((t) => {
      if (!t.name.startsWith('DM')) {
        items.push({
          id: `team-${t.id}`,
          type: 'team',
          label: `# ${t.name}`,
          sublabel: t.description,
          category: 'Group Channels',
          tab: 'teams',
          teamId: t.id,
          icon: Hash,
        });
      }
    });

    // 3. Members / Co-workers DMs
    if (company && company.members) {
      company.members.forEach((m) => {
        items.push({
          id: `member-${m.user_id}`,
          type: 'member',
          label: `@${m.username}`,
          sublabel: `Start direct message with ${m.username} (${m.role})`,
          category: 'Co-workers / DMs',
          tab: 'teams',
          memberUsername: m.username,
          icon: User,
        });
      });
    }

    // 4. Workspace Assets (Spreadsheet data cells, documents contents, whiteboards)
    assets.forEach((asset) => {
      let snippet = '';
      let cat = 'Documents';
      let tab = 'docs';
      let icon = FileText;

      const normType = asset.asset_type;


      if (normType === 'spreadsheet') {
        cat = 'Spreadsheets';
        tab = 'spreadsheet';
        icon = Table;
        if (asset.content) {
          try {
            const parsed = JSON.parse(asset.content);
            if (parsed && Array.isArray(parsed.data)) {
              const allCells: string[] = [];
              parsed.data.forEach((row: any) => {
                if (Array.isArray(row)) {
                  row.forEach((cell: any) => {
                    if (cell !== null && cell !== undefined) {
                      const str = String(cell).trim();
                      if (str) allCells.push(str);
                    }
                  });
                }
              });
              snippet = allCells.slice(0, 15).join(', ');
            }
          } catch (e) {
            // ignore
          }
        }
      } else if (normType === 'whiteboard') {
        cat = 'Whiteboards';
        tab = 'whiteboard';
        icon = PenTool;
        snippet = 'Real-time collaborative sketching & system diagrams';
      } else if (asset.content) {
        snippet = asset.content.replace(/<[^>]*>/g, ' ').substring(0, 80);
      }

      items.push({
        id: `asset-${asset.id}`,
        type: 'asset',
        label: asset.name || (normType === 'whiteboard' ? 'Collaborative Board' : 'Untitled Document'),
        sublabel: snippet || `${normType} asset`,
        category: cat,
        tab,
        icon,
      });
    });


    // 5. Chat messages
    chatMessages.forEach((msg) => {
      if (msg.message && !msg.message.includes('📞')) {
        items.push({
          id: `msg-${msg.id}`,
          type: 'message',
          label: msg.message.substring(0, 60),
          sublabel: `Sent by @${msg.username} in channel`,
          category: 'Chat Messages',
          tab: 'teams',
          teamId: msg.team_id,
          icon: MessageSquare,
        });
      }
    });

    return items;
  }, [teams, company, assets, chatMessages]);

  // Initialize Fuse.js for ultra-fast fuzzy client search
  const fuse = useMemo(() => {
    return new Fuse(searchItems, {
      keys: ['label', 'sublabel', 'category'],
      threshold: 0.35,
      shouldSort: true,
    });
  }, [searchItems]);

  const results = useMemo(() => {
    if (!query.trim()) {
      return searchItems.slice(0, 8); // show default navigations
    }
    return fuse.search(query).map((r) => r.item);
  }, [fuse, query, searchItems]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-start justify-center pt-24 px-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden backdrop-blur-xl transition-all">
        
        {/* Search Input Header */}
        <div className="flex items-center px-6 py-4 border-b border-slate-100 gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Fuzzy search channels, spreadsheet cells, docs, chat messages... (Cmd+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none text-sm font-semibold"
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Results List */}
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-semibold">
              No matching workspace assets, channels or messages found.
            </div>
          ) : (
            results.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.tab, item.teamId, item.memberUsername);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl hover:bg-indigo-50/70 hover:text-indigo-900 group transition-all text-left"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center text-slate-600 transition-colors shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 group-hover:text-indigo-950 truncate">
                        {item.label}
                      </div>
                      {item.sublabel && (
                        <div className="text-[10px] text-slate-400 group-hover:text-indigo-900/60 truncate mt-0.5">
                          {item.sublabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider group-hover:bg-indigo-100 group-hover:text-indigo-700">
                      {item.category}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-600 transition-colors" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts info */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-semibold">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md shadow-xs text-slate-500 font-mono text-[9px]">ESC</kbd>
            <span>to close</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span>Fuzzy Engine Active</span>
          </div>
        </div>

      </div>
    </div>
  );
};
