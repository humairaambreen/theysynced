import React from 'react';
import { ActiveTab } from '../types';
import { LayoutGrid, MessageSquare, PenTool, Table, FileText, Activity, Monitor, FolderGit2, Terminal } from 'lucide-react';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
}) => {
  const navItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'overview', label: 'Office Perks', icon: LayoutGrid },
    { id: 'teams', label: 'Teams & Chat', icon: MessageSquare },
    { id: 'assets', label: 'File System (GUI)', icon: FolderGit2 },
    { id: 'terminal', label: 'Linux Terminal', icon: Terminal },
    { id: 'rdp', label: 'Remote Desktop', icon: Monitor },
    { id: 'whiteboard', label: 'Excalidraw', icon: PenTool },
    { id: 'spreadsheet', label: 'Spreadsheets', icon: Table },
    { id: 'docs', label: 'Docs', icon: FileText },
    { id: 'activity', label: 'Activity Hub', icon: Activity },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 shrink-0 bg-white/70 backdrop-blur-sm border-r border-black/[0.04] p-4 flex-col justify-between font-sans select-none">
        <div className="w-full space-y-4 flex flex-col">
          {/* Workspace Apps Section */}
          <div className="space-y-1.5 w-full">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Workspace Apps
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-full text-xs font-semibold transition-all shrink-0 w-full ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-300' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer info pill */}
        <div className="mt-auto p-4 rounded-3xl bg-[#F4F2EC] text-slate-700 text-xs w-full">
          <p className="font-semibold text-slate-900 mb-1">TheySynced Enterprise</p>
          <p className="text-[11px] text-slate-500 leading-snug">
            Realtime collaboration, premium minimalist light UI.
          </p>
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar (Modern Floating Pill Dock) */}
      <nav className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white/90 backdrop-blur-md border border-slate-200/50 shadow-[0_8px_32px_rgba(0,0,0,0.08)] rounded-full p-1.5 flex items-center space-x-1 max-w-[95vw]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          if (isActive) {
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="bg-slate-900 text-white rounded-full px-4 py-2 flex items-center space-x-2 transition-all duration-300 shadow-md shrink-0"
              >
                <Icon className="w-4 h-4 text-indigo-300 shrink-0" />
                <span className="text-[11px] font-bold tracking-tight whitespace-nowrap">{item.label.split(' ')[0]}</span>
              </button>
            );
          } else {
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="p-2.5 text-slate-500 hover:text-slate-950 hover:bg-slate-100/50 rounded-full transition-all duration-200 shrink-0"
              >
                <Icon className="w-4 h-4 shrink-0" />
              </button>
            );
          }
        })}
      </nav>
    </>
  );
};
