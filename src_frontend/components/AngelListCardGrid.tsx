import React from 'react';
import { ActiveTab, Company } from '../types';
import { ArrowUpRight, PenTool, Table, FileText, Activity, MessageSquare, Sparkles } from 'lucide-react';


interface AngelListCardGridProps {
  company: Company | null;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const AngelListCardGrid: React.FC<AngelListCardGridProps> = ({ company, onNavigateTab }) => {
  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in duration-300">
      
      {/* Top Banner */}
      <div className="mb-4 md:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-5xl font-extrabold text-slate-900 tracking-tight font-sans">
            Collaborative Office Space
          </h1>

          <p className="mt-1 md:mt-2 text-slate-500 text-xs md:text-base font-light max-w-xl hidden md:block">
            Realtime Excalidraw whiteboards, statistical spreadsheets, Notion-like docs, and WebRTC video calls with a premium light UI.
          </p>
        </div>

        <div className="flex items-center space-x-3 hidden md:flex">
          <button
            onClick={() => onNavigateTab('whiteboard')}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-full text-xs font-semibold shadow-sm hover:scale-[1.02] transition-transform flex items-center space-x-2"
          >
            <PenTool className="w-3.5 h-3.5 text-indigo-300" />
            <span>Open Whiteboard</span>
          </button>
        </div>
      </div>

      {/* AngelList 5-Card Layout Grid matching exact screenshot layout & shapes */}
      {/* Mobile-optimized compact layout (fits entirely within phone viewport without scrolling) */}
      <div className="md:hidden grid grid-cols-2 gap-3 items-stretch">
        {/* Card 1: Excalidraw */}
        <div
          onClick={() => onNavigateTab('whiteboard')}
          className="p-4 rounded-[28px] bg-[#7F7149] text-white flex flex-col justify-between min-h-[100px] shadow-xs active:scale-[0.98] transition-transform cursor-pointer"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200/90">Canvas</span>
          <div className="flex items-end justify-between mt-2">
            <h3 className="text-sm font-bold leading-tight">Excalidraw</h3>
            <PenTool className="w-4 h-4 text-indigo-200" />
          </div>
        </div>

        {/* Card 2: Spreadsheet */}
        <div
          onClick={() => onNavigateTab('spreadsheet')}
          className="p-4 rounded-[28px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between min-h-[100px] shadow-xs active:scale-[0.98] transition-transform cursor-pointer"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Analysis</span>
          <div className="flex items-end justify-between mt-2">
            <h3 className="text-sm font-bold leading-tight">Spreadsheets</h3>
            <Table className="w-4 h-4 text-indigo-600" />
          </div>
        </div>

        {/* Card 3: Teams (Full width row) */}
        <div
          onClick={() => onNavigateTab('teams')}
          className="col-span-2 p-4.5 rounded-[28px] bg-[#E0E3FF] text-[#111827] flex items-center justify-between min-h-[90px] shadow-xs active:scale-[0.98] transition-transform cursor-pointer"
        >
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Channels & Meet</span>
            <h3 className="text-sm font-extrabold mt-0.5">Teams, Chat & HD Calls</h3>
          </div>
          <div className="w-9 h-9 rounded-full bg-slate-950 text-white flex items-center justify-center shadow-xs">
            <MessageSquare className="w-4 h-4 text-indigo-300" />
          </div>
        </div>

        {/* Card 4: Docs */}
        <div
          onClick={() => onNavigateTab('docs')}
          className="p-4 rounded-[28px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between min-h-[100px] shadow-xs active:scale-[0.98] transition-transform cursor-pointer"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Wiki</span>
          <div className="flex items-end justify-between mt-2">
            <h3 className="text-sm font-bold leading-tight">Docs & PDFs</h3>
            <FileText className="w-4 h-4 text-indigo-600" />
          </div>
        </div>

        {/* Card 5: Activity */}
        <div
          onClick={() => onNavigateTab('activity')}
          className="p-4 rounded-[28px] bg-[#F4F2EC] text-slate-900 flex flex-col justify-between min-h-[100px] shadow-xs active:scale-[0.98] transition-transform cursor-pointer"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">History</span>
          <div className="flex items-end justify-between mt-2">
            <h3 className="text-sm font-bold leading-tight">Activity Hub</h3>
            <Activity className="w-4 h-4 text-slate-600" />
          </div>
        </div>
      </div>

      {/* AngelList 5-Card Layout Grid matching exact screenshot layout & shapes (Desktop Only) */}
      <div className="hidden md:grid grid-cols-3 gap-6 items-stretch">
        
        {/* Left Column (2 Cards) */}
        <div className="flex flex-col gap-6 justify-between">
          
          {/* Card 1: Warm Golden Olive Squircle */}
          <div className="p-8 rounded-[44px] bg-[#7F7149] text-white flex flex-col justify-between min-h-[260px] shadow-sm hover:shadow-xl transition-all duration-300 group">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-200/90 block mb-2">
                Realtime Whiteboarding
              </span>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-3">
                Excalidraw & Architecture Boards
              </h3>
              <p className="text-white/80 text-xs md:text-sm font-light leading-relaxed">
                Sketch system designs, flowcharts, sticky notes, and vector drawings live with your team using real-time WebSocket sync.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('whiteboard')}
              className="mt-6 inline-flex items-center space-x-2 text-xs font-semibold text-white/90 hover:text-white group-hover:translate-x-1 transition-transform"
            >
              <span>Launch Whiteboard</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          {/* Card 2: Light Pearl Squircle */}
          <div className="p-8 rounded-[40px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between min-h-[280px] shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Statistical Analytics
              </span>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-3 text-slate-900">
                Excel & Spreadsheet Sheets
              </h3>
              <p className="text-slate-500 text-xs md:text-sm font-light leading-relaxed">
                Full numerical grid calculation with mathematical formulas (SUM, AVERAGE, MIN, MAX), cell styling, and interactive chart creation.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('spreadsheet')}
              className="mt-6 inline-flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200/70 text-slate-800 rounded-full text-xs font-semibold self-start transition-colors"
            >
              <Table className="w-3.5 h-3.5 text-indigo-600" />
              <span>Open Spreadsheet</span>
            </button>
          </div>

        </div>

        {/* Center Column: Periwinkle Soft Lavender Pill Oval Card */}
        <div className="p-8 md:p-10 rounded-[60px] md:rounded-[200px/140px] bg-[#E0E3FF] text-[#111827] flex flex-col items-center justify-center text-center min-h-[520px] shadow-sm hover:shadow-2xl transition-all duration-300 relative group overflow-hidden">
          <div className="max-w-xs z-10">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 block mb-3">
              Office Communications
            </span>
            <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-4 text-slate-900">
              Teams, Channels & HD Meetings
            </h3>
            <p className="text-slate-700 text-xs md:text-sm font-light leading-relaxed mb-8">
              Create unlimited company teams, discuss in real-time channels, attach files, and start instant WebRTC video/audio meetings with screen share.
            </p>
          </div>

          {/* Circle Arrow Action Button (matches AngelList center button in screenshot) */}
          <button
            onClick={() => onNavigateTab('activity')}
            className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform z-10"
            title="View Activity Hub"
          >
            <Activity className="w-6 h-6 text-indigo-300" />
          </button>

        </div>

        {/* Right Column (2 Cards) */}
        <div className="flex flex-col gap-6 justify-between">
          
          {/* Card 4: Light White Card */}
          <div className="p-8 rounded-[40px] bg-white border border-black/[0.05] text-slate-900 flex flex-col justify-between min-h-[260px] shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Knowledge & Documentation
              </span>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-3 text-slate-900">
                Rich Text Docs & PDFs
              </h3>
              <p className="text-slate-500 text-xs md:text-sm font-light leading-relaxed">
                Write team meeting notes, technical specifications, and preview uploaded PDFs directly within your company space.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('docs')}
              className="mt-6 inline-flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200/70 text-slate-800 rounded-full text-xs font-semibold self-start transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Create Document</span>
            </button>
          </div>

          {/* Card 5: Soft Beige Squircle */}
          <div className="p-8 rounded-[44px] bg-[#F4F2EC] text-slate-900 flex flex-col justify-between min-h-[280px] shadow-sm hover:shadow-xl transition-all duration-300">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">
                Instant Chat
              </span>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-3 text-slate-900">
                Direct Messaging & Groups
              </h3>
              <p className="text-slate-600 text-xs md:text-sm font-light leading-relaxed">
                Connect with co-workers across teams, post code snippets, share documents, and collaborate without friction.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('teams')}
              className="mt-6 inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-full text-xs font-semibold self-start hover:scale-[1.02] transition-transform"
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
