'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Company, UserProfile, WorkspaceAsset, TaskItem, TaskPriority, TaskStatus, ActiveTab } from '../types';
import { 
  CheckSquare, Plus, Search, Calendar, User, Tag, 
  Download, Terminal, Trash2, Edit3, CheckCircle2, Clock,
  List, LayoutGrid, Check, ChevronLeft, ChevronRight, X, Circle
} from 'lucide-react';

interface TasksKanbanViewProps {
  user: UserProfile;
  company: Company;
  assets: WorkspaceAsset[];
  websocket: WebSocket | null;
  onSaveAsset: (asset: Partial<WorkspaceAsset>) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onNavigateTab?: (tab: ActiveTab, subItem?: string) => void;
}

type SimpleColumnId = 'todo' | 'in_progress' | 'done';

const COLUMNS: { id: SimpleColumnId; label: string; emoji: string; countColor: string; borderColor: string; bgHeader: string }[] = [
  { id: 'todo', label: 'To Do', emoji: '📝', countColor: 'bg-blue-100 text-blue-700', borderColor: 'border-blue-200/80', bgHeader: 'bg-blue-50/50' },
  { id: 'in_progress', label: 'In Progress', emoji: '⚡', countColor: 'bg-amber-100 text-amber-800', borderColor: 'border-amber-200/80', bgHeader: 'bg-amber-50/50' },
  { id: 'done', label: 'Done', emoji: '✅', countColor: 'bg-emerald-100 text-emerald-800', borderColor: 'border-emerald-200/80', bgHeader: 'bg-emerald-50/50' },
];

export const TasksKanbanView: React.FC<TasksKanbanViewProps> = ({
  user,
  company,
  assets,
  websocket,
  onSaveAsset,
  onNavigateTab,
}) => {
  const assetKey = `tasks_${company.id}`;
  
  // Default Initial Tasks
  const defaultTasks: TaskItem[] = useMemo(() => [
    {
      id: 'TASK-1',
      company_id: company.id,
      title: 'Architect Cloudflare D1 & KV edge storage integration',
      description: 'Implement edge persistence with zero-server backend and hourly inactivity retention sweeper.',
      status: 'done',
      priority: 'high',
      assignee: user.username,
      creator: user.username,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      updated_at: new Date().toISOString(),
      due_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
      tags: ['Backend', 'Storage'],
    },
    {
      id: 'TASK-2',
      company_id: company.id,
      title: 'Real Debian Linux x86 virtual machine with real apt-get',
      description: 'CheerpX WebAssembly Linux virtual machine with official Debian mirror access and dynamic package resolution.',
      status: 'done',
      priority: 'high',
      assignee: user.username,
      creator: user.username,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Linux', 'Debian'],
    },
    {
      id: 'TASK-3',
      company_id: company.id,
      title: 'Company workspace management & membership permissions',
      description: 'Enable creating, joining, switching, leaving, and deleting workspaces with D1 encryption.',
      status: 'in_progress',
      priority: 'medium',
      assignee: user.username,
      creator: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Workspaces', 'Auth'],
    },
    {
      id: 'TASK-4',
      company_id: company.id,
      title: 'Add team to-dos and milestone tracking',
      description: 'Simple, streamlined task board for planning sprints and tracking daily tasks.',
      status: 'todo',
      priority: 'low',
      assignee: user.username,
      creator: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Tasks'],
    },
  ], [company.id, user.username]);

  const [tasks, setTasks] = useState<TaskItem[]>(defaultTasks);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  
  // Fast Inline Add state
  const [quickTitle, setQuickTitle] = useState('');
  const [quickColumn, setQuickColumn] = useState<SimpleColumnId>('todo');

  // Task Details / Edit Modal State
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);

  // Load from Company Asset
  useEffect(() => {
    const asset = assets.find((a) => a.id === assetKey);
    if (asset && asset.content) {
      try {
        const parsed = JSON.parse(asset.content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTasks(parsed);
        }
      } catch (_) {}
    }
  }, [assets, assetKey]);

  // WebSocket Live Updates
  useEffect(() => {
    if (!websocket) return;

    const handleWs = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'tasks_update' && data.company_id === company.id) {
          if (Array.isArray(data.tasks)) {
            setTasks(data.tasks);
          }
        }
      } catch (_) {}
    };

    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, company.id]);

  // Persist Tasks to D1 & Linux Filesystem
  const saveTasks = async (updatedTasks: TaskItem[]) => {
    setTasks(updatedTasks);
    
    // Save to primary company asset in D1
    await onSaveAsset({
      id: assetKey,
      company_id: company.id,
      asset_type: 'file',
      name: 'tasks.json',
      folder_path: '/workspace/tasks',
      content: JSON.stringify(updatedTasks, null, 2),
      size: JSON.stringify(updatedTasks).length,
      created_by: user.username,
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });

    // Broadcast over WebSocket if connected
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({
        type: 'tasks_update',
        company_id: company.id,
        tasks: updatedTasks,
        sender: user.username,
      }));
    }
  };

  // Helper to normalize task status into one of 3 simple columns
  const getSimpleStatus = (status: TaskStatus): SimpleColumnId => {
    if (status === 'done') return 'done';
    if (status === 'in_progress' || status === 'review') return 'in_progress';
    return 'todo'; // backlog & todo both map to todo
  };

  // Fast Inline Add
  const handleQuickAdd = async (e: React.FormEvent, targetColumn: SimpleColumnId = 'todo') => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;

    const nextNumber = tasks.length + 1;
    const newTask: TaskItem = {
      id: `TASK-${nextNumber}`,
      company_id: company.id,
      title,
      description: '',
      status: targetColumn,
      priority: 'medium',
      assignee: user.username,
      creator: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: [],
    };

    const nextTasks = [newTask, ...tasks];
    setQuickTitle('');
    await saveTasks(nextTasks);
  };

  // 1-Click Checkbox Completion Toggle
  const handleToggleDone = async (task: TaskItem) => {
    const isDone = getSimpleStatus(task.status) === 'done';
    const nextStatus: TaskStatus = isDone ? 'todo' : 'done';

    const updatedTasks = tasks.map((t) => {
      if (t.id === task.id) {
        return { ...t, status: nextStatus, updated_at: new Date().toISOString() };
      }
      return t;
    });

    await saveTasks(updatedTasks);
  };

  // Move task to next or previous column
  const handleMoveStep = async (task: TaskItem, direction: 'prev' | 'next') => {
    const current = getSimpleStatus(task.status);
    let next: SimpleColumnId = current;

    if (direction === 'next') {
      if (current === 'todo') next = 'in_progress';
      else if (current === 'in_progress') next = 'done';
    } else {
      if (current === 'done') next = 'in_progress';
      else if (current === 'in_progress') next = 'todo';
    }

    if (next === current) return;

    const updated = tasks.map((t) => {
      if (t.id === task.id) {
        return { ...t, status: next, updated_at: new Date().toISOString() };
      }
      return t;
    });

    await saveTasks(updated);
  };

  // Change task status directly
  const handleChangeStatus = async (taskId: string, newStatus: TaskStatus) => {
    const updated = tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, status: newStatus, updated_at: new Date().toISOString() };
      }
      return t;
    });
    await saveTasks(updated);
  };

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    const updated = tasks.filter((t) => t.id !== taskId);
    if (selectedTask?.id === taskId) setSelectedTask(null);
    await saveTasks(updated);
  };

  // Save edits to selected task
  const handleSaveSelectedTask = async (updatedTask: TaskItem) => {
    const next = tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
    setSelectedTask(updatedTask);
    setIsEditingTask(false);
    await saveTasks(next);
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchId = t.id.toLowerCase().includes(q);
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        if (!matchTitle && !matchId && !matchDesc) return false;
      }
      if (filterPriority !== 'all' && t.priority !== filterPriority) {
        return false;
      }
      return true;
    });
  }, [tasks, searchQuery, filterPriority]);

  // Member usernames for assignee picker
  const membersList = useMemo(() => {
    const list = [user.username];
    (company.members || []).forEach((m) => {
      if (m.username && !list.includes(m.username)) list.push(m.username);
    });
    return list;
  }, [company.members, user.username]);

  // Export tasks as CSV
  const handleExportCsv = () => {
    const headers = ['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Created At'];
    const rows = tasks.map((t) => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.assignee,
      t.created_at,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${company.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_tasks.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPriorityBadge = (p: TaskPriority) => {
    switch (p) {
      case 'urgent':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Urgent</span>;
      case 'high':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">High</span>;
      case 'medium':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Medium</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200">Low</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F8F9FB] overflow-hidden font-sans">
      
      {/* Clean Modern Top Header */}
      <header className="px-6 py-3.5 bg-white border-b border-black/[0.04] flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
            <CheckSquare className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Tasks</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                {tasks.filter((t) => getSimpleStatus(t.status) !== 'done').length} pending
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Company to-dos &bull; Synced with <span className="font-mono text-slate-600">/workspace/tasks/</span>
            </p>
          </div>
        </div>

        {/* View Toggle & Actions */}
        <div className="flex items-center space-x-2">
          {/* Board vs List view switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200/80">
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'board' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>

          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('terminal', '/workspace/tasks')}
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              title="Inspect tasks file in Linux Terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-slate-600" />
              <span className="hidden sm:inline">CLI</span>
            </button>
          )}

          <button
            onClick={handleExportCsv}
            className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* Fast Quick Add & Filter Bar */}
      <div className="px-6 py-3 bg-white/70 backdrop-blur-sm border-b border-black/[0.04] flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        {/* Quick Add Form */}
        <form onSubmit={(e) => handleQuickAdd(e, quickColumn)} className="relative flex-1 w-full max-w-xl flex items-center">
          <input
            type="text"
            placeholder="Add a new task... (press Enter to save)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            className="w-full pl-4 pr-24 py-2 bg-slate-50 border border-slate-200/90 rounded-2xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all"
          />
          <button
            type="submit"
            disabled={!quickTitle.trim()}
            className="absolute right-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs disabled:opacity-40 transition-all"
          >
            Add Task
          </button>
        </form>

        {/* Search & Priority Filter */}
        <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
          <div className="relative w-40">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Main Content: Board View or List View */}
      {viewMode === 'board' ? (
        /* 3-Column Clean Board */
        <div className="flex-1 p-6 overflow-x-auto overflow-y-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 h-full max-w-6xl mx-auto">
            {COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => getSimpleStatus(t.status) === col.id);
              return (
                <div
                  key={col.id}
                  className={`flex flex-col bg-slate-50/70 border ${col.borderColor} rounded-3xl p-4 h-full overflow-hidden shadow-xs`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between pb-3 mb-2 border-b border-black/[0.04] shrink-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-base">{col.emoji}</span>
                      <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">{col.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${col.countColor}`}>
                        {colTasks.length}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setQuickColumn(col.id);
                        const title = prompt(`Add a new task to ${col.label}:`);
                        if (title && title.trim()) {
                          const nextNumber = tasks.length + 1;
                          const newTask: TaskItem = {
                            id: `TASK-${nextNumber}`,
                            company_id: company.id,
                            title: title.trim(),
                            description: '',
                            status: col.id,
                            priority: 'medium',
                            assignee: user.username,
                            creator: user.username,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            tags: [],
                          };
                          saveTasks([newTask, ...tasks]);
                        }
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-white transition"
                      title={`Add task to ${col.label}`}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Cards Container */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {colTasks.length === 0 ? (
                      <div className="h-28 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-200 rounded-2xl text-slate-400 text-xs">
                        <span>No tasks in {col.label}</span>
                      </div>
                    ) : (
                      colTasks.map((t) => {
                        const isDone = col.id === 'done';
                        return (
                          <div
                            key={t.id}
                            className={`bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer ${
                              isDone ? 'opacity-70 bg-slate-50/50' : ''
                            }`}
                            onClick={() => setSelectedTask(t)}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDone(t);
                                  }}
                                  className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 transition-colors"
                                  title={isDone ? 'Mark as To Do' : 'Mark as Done'}
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                  ) : (
                                    <Circle className="w-4 h-4 text-slate-300 hover:text-emerald-500" />
                                  )}
                                </button>

                                <span className={`text-xs font-semibold text-slate-900 flex-1 leading-snug ${
                                  isDone ? 'line-through text-slate-400' : ''
                                }`}>
                                  {t.title}
                                </span>

                                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                                  {getPriorityBadge(t.priority)}
                                </div>
                              </div>

                              {t.description && (
                                <p className="text-[11px] text-slate-500 line-clamp-2 pl-6 mb-2">
                                  {t.description}
                                </p>
                              )}
                            </div>

                            {/* Card Footer */}
                            <div className="pt-2 mt-1 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 pl-6">
                              <span className="text-[10px] font-medium text-slate-500">
                                @{t.assignee}
                              </span>

                              {/* Arrow Quick Mover */}
                              <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                {col.id !== 'todo' && (
                                  <button
                                    onClick={() => handleMoveStep(t, 'prev')}
                                    className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                                    title="Move left"
                                  >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {col.id !== 'done' && (
                                  <button
                                    onClick={() => handleMoveStep(t, 'next')}
                                    className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                                    title="Move right"
                                  >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  onClick={() => handleDeleteTask(t.id)}
                                  className="p-1 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 ml-1 transition"
                                  title="Delete task"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Clean Checklist / List View */
        <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full">
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No tasks match your filters.
              </div>
            ) : (
              filteredTasks.map((t) => {
                const isDone = getSimpleStatus(t.status) === 'done';
                return (
                  <div
                    key={t.id}
                    className={`p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer group ${
                      isDone ? 'bg-slate-50/40' : ''
                    }`}
                    onClick={() => setSelectedTask(t)}
                  >
                    <div className="flex items-center space-x-3.5 flex-1 min-w-0 pr-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDone(t);
                        }}
                        className="text-slate-300 hover:text-emerald-500 transition-colors shrink-0"
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Circle className="w-5 h-5 text-slate-300 hover:text-emerald-500" />
                        )}
                      </button>

                      <div className="truncate">
                        <div className={`text-xs font-semibold text-slate-900 truncate ${
                          isDone ? 'line-through text-slate-400' : ''
                        }`}>
                          {t.title}
                        </div>
                        {t.description && (
                          <div className="text-[11px] text-slate-400 truncate">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={getSimpleStatus(t.status)}
                        onChange={(e) => handleChangeStatus(t.id, e.target.value as TaskStatus)}
                        className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 cursor-pointer"
                      >
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>

                      {getPriorityBadge(t.priority)}

                      <span className="text-xs font-medium text-slate-500 hidden sm:inline">
                        @{t.assignee}
                      </span>

                      <button
                        onClick={() => handleDeleteTask(t.id)}
                        className="p-1.5 text-slate-300 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                        title="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Lightweight Task Details / Edit Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="font-mono text-xs font-bold text-slate-400">{selectedTask.id}</span>
              <button
                onClick={() => setSelectedTask(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Task Title
                </label>
                <input
                  type="text"
                  value={selectedTask.title}
                  onChange={(e) => setSelectedTask({ ...selectedTask, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Notes / Description
                </label>
                <textarea
                  rows={3}
                  value={selectedTask.description || ''}
                  onChange={(e) => setSelectedTask({ ...selectedTask, description: e.target.value })}
                  placeholder="Add notes or details..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={getSimpleStatus(selectedTask.status)}
                    onChange={(e) => setSelectedTask({ ...selectedTask, status: e.target.value as TaskStatus })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Priority
                  </label>
                  <select
                    value={selectedTask.priority}
                    onChange={(e) => setSelectedTask({ ...selectedTask, priority: e.target.value as TaskPriority })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Assignee
                </label>
                <select
                  value={selectedTask.assignee}
                  onChange={(e) => setSelectedTask({ ...selectedTask, assignee: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  {membersList.map((m) => (
                    <option key={m} value={m}>@{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleDeleteTask(selectedTask.id)}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveSelectedTask(selectedTask)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
