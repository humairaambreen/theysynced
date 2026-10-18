import React from 'react';
import { ActiveTab, Company } from '../types';
import { ArrowUpRight, PenTool, Table, FileText, Activity, MessageSquare, Monitor } from 'lucide-react';

interface OfficeOverviewGridProps {
  company: Company | null;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const OfficeOverviewGrid: React.FC<OfficeOverviewGridProps> = ({ company, onNavigateTab }) => {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-3 md:py-4 h-full flex flex-col md:h-[calc(100vh-5rem)] overflow-y-auto md:overflow-hidden animate-in fade-in duration-300">
      
      {/* Top Banner */}
      <div className="mb-2 md:mb-4 flex flex-col md:flex-row md:items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-4xl font-extrabold text-slate-900 tracking-tight font-sans">
            Collaborative Office Space
          </h1>
          <p className="mt-1 text-slate-500 text-xs md:text-sm font-light max-w-xl hidden md:block">
            Realtime Excalidraw whiteboards, statistical spreadsheets, Notion-like docs, Remote Desktop RDP, and Teams chat.
          </p>
        </div>

        <div className="flex items-center space-x-3 hidden md:flex">
          <button
            onClick={() => onNavigateTab('rdp')}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-full text-xs font-semibold shadow-sm transition-all flex items-center space-x-2 border border-indigo-200/60"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Remote Desktop (RDP)</span>
          </button>
          <button
            onClick={() => onNavigateTab('whiteboard')}
            className="px-4 py-2 bg-slate-900 text-white rounded-full text-xs font-semibold shadow-sm hover:scale-[1.02] transition-transform flex items-center space-x-2"
          >
            <PenTool className="w-3.5 h-3.5 text-indigo-300" />
            <span>Open Whiteboard</span>
          </button>
        </div>
      </div>

      {/* ── MOBILE BENTO GRID ── */}
      <div className="md:hidden flex flex-col gap-3 pb-4">

        {/* Row 1: Canvas + Analysis */}
        <div className="grid grid-cols-2 gap-3">

          {/* Card 1: Excalidraw — Warm Olive */}
          <div
            onClick={() => onNavigateTab('whiteboard')}
            className="p-4 rounded-[28px] bg-[#7F7149] text-white flex flex-col justify-between active:scale-[0.97] transition-all cursor-pointer"
          >
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-200/80 block mb-1">Canvas</span>
              <h3 className="text-sm font-bold leading-snug">Excalidraw &amp; Boards</h3>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
              <span className="text-[10px] text-white/60">Launch canvas</span>
              <PenTool className="w-3.5 h-3.5 text-indigo-200" />
            </div>
          </div>

          {/* Card 2: Spreadsheets — White */}
          <div
            onClick={() => onNavigateTab('spreadsheet')}
            className="p-4 rounded-[28px] bg-white border border-black/[0.06] text-slate-900 flex flex-col justify-between active:scale-[0.97] transition-all cursor-pointer"
          >
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Analysis</span>
              <h3 className="text-sm font-bold leading-snug">Excel Sheets</h3>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500">Open grid</span>
              <Table className="w-3.5 h-3.5 text-indigo-600" />
            </div>
          </div>
        </div>

        {/* Card 3: Communications — Full-width Lavender, auto height */}
        <div
          onClick={() => onNavigateTab('teams')}
          className="w-full p-5 rounded-[32px] bg-[#E0E3FF] text-[#111827] flex flex-col items-center text-center gap-3 active:scale-[0.97] transition-all cursor-pointer"
        >
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-600 block mb-1">Communications</span>
            <h3 className="text-base font-extrabold leading-snug">Teams, Chat &amp; HD Meetings</h3>
            <p className="text-[11px] text-slate-600 mt-1.5 max-w-[260px] mx-auto leading-relaxed">Real-time chat channels, direct messages &amp; WebRTC meetings.</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-slate-950 text-white flex items-center justify-center shadow-md shrink-0">
            <MessageSquare className="w-4 h-4 text-indigo-300" />
          </div>
        </div>

        {/* Row 2: Docs + Activity */}
        <div className="grid grid-cols-2 gap-3">

          {/* Card 4: Docs — White */}
          <div
            onClick={() => onNavigateTab('docs')}
            className="p-4 rounded-[28px] bg-white border border-black/[0.06] text-slate-900 flex flex-col justify-between active:scale-[0.97] transition-all cursor-pointer"
          >
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Wiki</span>
              <h3 className="text-sm font-bold leading-snug">Docs &amp; PDFs</h3>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500">Create notes</span>
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
            </div>
          </div>

          {/* Card 5: Activity — Beige */}
          <div
            onClick={() => onNavigateTab('activity')}
            className="p-4 rounded-[28px] bg-[#F4F2EC] text-slate-900 flex flex-col justify-between active:scale-[0.97] transition-all cursor-pointer"
          >
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">History</span>
              <h3 className="text-sm font-bold leading-snug">Activity Hub</h3>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200/50">
              <span className="text-[10px] text-slate-600">Audit logs</span>
              <Activity className="w-3.5 h-3.5 text-slate-600" />
            </div>
          </div>
        </div>

      </div>

      {/* Bento 5-Card Layout Grid matching exact screenshot layout & shapes (Desktop Only) */}
      <div className="hidden md:grid grid-cols-3 gap-5 items-stretch flex-1 min-h-0 pb-2">
        
        {/* Left Column (2 Cards) */}
        <div className="flex flex-col gap-5 justify-between h-full min-h-0">
          
          {/* Card 1: Warm Golden Olive Squircle */}
          <div className="p-6 rounded-[36px] bg-[#7F7149] text-white flex flex-col justify-between flex-1 min-h-0 shadow-sm hover:shadow-xl transition-all duration-300 group">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-200/90 block mb-1.5">
                Realtime Whiteboarding
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-2">
                Excalidraw & Architecture Boards
              </h3>
              <p className="text-white/80 text-xs font-light leading-relaxed">
                Sketch system designs, flowcharts, sticky notes, and vector drawings live with your team using real-time WebSocket sync.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('whiteboard')}
              className="mt-4 inline-flex items-center space-x-2 text-xs font-semibold text-white/90 hover:text-white group-hover:translate-x-1 transition-transform"
            >
              <span>Launch Whiteboard</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          {/* Card 2: Light Pearl Squircle */}
          <div className="p-6 rounded-[36px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between flex-1 min-h-0 shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Statistical Analytics
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-2 text-slate-900">
                Excel & Spreadsheet Sheets
              </h3>
              <p className="text-slate-500 text-xs font-light leading-relaxed">
                Full numerical grid calculation with mathematical formulas (SUM, AVERAGE, MIN, MAX), cell styling, and interactive chart creation.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('spreadsheet')}
              className="mt-4 inline-flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200/70 text-slate-800 rounded-full text-xs font-semibold self-start transition-colors"
            >
              <Table className="w-3.5 h-3.5 text-indigo-600" />
              <span>Open Spreadsheet</span>
            </button>
          </div>

        </div>

        {/* Center Column: Periwinkle Soft Lavender Pill Oval Card */}
        <div className="p-6 md:p-8 rounded-[48px] md:rounded-[160px/110px] bg-[#E0E3FF] text-[#111827] flex flex-col items-center justify-center text-center h-full min-h-0 shadow-sm hover:shadow-2xl transition-all duration-300 relative group overflow-hidden">
          <div className="max-w-xs z-10">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 block mb-2">
              Office Communications
            </span>
            <h3 className="text-xl md:text-2xl font-extrabold tracking-tight mb-3 text-slate-900">
              Teams, Channels & HD Meetings
            </h3>
            <p className="text-slate-700 text-xs font-light leading-relaxed mb-6">
              Create unlimited company teams, discuss in real-time channels, attach files, and start instant WebRTC video/audio meetings with screen share.
            </p>
          </div>

          {/* Circle Arrow Action Button */}
          <button
            onClick={() => onNavigateTab('activity')}
            className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform z-10"
            title="View Activity Hub"
          >
            <Activity className="w-5 h-5 text-indigo-300" />
          </button>

        </div>

        {/* Right Column (2 Cards) */}
        <div className="flex flex-col gap-5 justify-between h-full min-h-0">
          
          {/* Card 4: Light White Card */}
          <div className="p-6 rounded-[36px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between flex-1 min-h-0 shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Knowledge & Documentation
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-2 text-slate-900">
                Rich Text Docs & PDFs
              </h3>
              <p className="text-slate-500 text-xs font-light leading-relaxed">
                Write team meeting notes, technical specifications, and preview uploaded PDFs directly within your company space.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('docs')}
              className="mt-4 inline-flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200/70 text-slate-800 rounded-full text-xs font-semibold self-start transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Create Document</span>
            </button>
          </div>

          {/* Card 5: Soft Beige Squircle */}
          <div className="p-6 rounded-[36px] bg-[#F4F2EC] text-slate-900 flex flex-col justify-between flex-1 min-h-0 shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                Instant Chat
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-2 text-slate-900">
                Direct Messaging & Groups
              </h3>
              <p className="text-slate-600 text-xs font-light leading-relaxed">
                Connect with co-workers across teams, post code snippets, share documents, and collaborate without friction.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('teams')}
              className="mt-4 inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-full text-xs font-semibold self-start hover:scale-[1.02] transition-transform"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-300" />
              <span>Go to Chat</span>
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
