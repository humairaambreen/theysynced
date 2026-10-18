'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Company, UserProfile, WorkspaceAsset, TaskItem, TaskPriority, TaskStatus, ActiveTab } from '../types';
import { 
  CheckSquare, Plus, Search, Filter, Calendar, User, Tag, 
  AlertCircle, ChevronRight, Download, Terminal, FolderGit2, 
  Trash2, Edit3, MoveRight, ArrowRight, CheckCircle2, Clock
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

const COLUMNS: { id: TaskStatus; label: string; color: string; countColor: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'border-slate-300 bg-slate-50/50', countColor: 'bg-slate-200 text-slate-700' },
  { id: 'todo', label: 'To Do', color: 'border-blue-300 bg-blue-50/30', countColor: 'bg-blue-100 text-blue-700' },
  { id: 'in_progress', label: 'In Progress', color: 'border-amber-300 bg-amber-50/30', countColor: 'bg-amber-100 text-amber-800' },
  { id: 'review', label: 'In Review', color: 'border-purple-300 bg-purple-50/30', countColor: 'bg-purple-100 text-purple-800' },
  { id: 'done', label: 'Done', color: 'border-emerald-300 bg-emerald-50/30', countColor: 'bg-emerald-100 text-emerald-800' },
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
  
  // Default Seed Tasks
  const defaultTasks: TaskItem[] = useMemo(() => [
    {
      id: 'TS-101',
      company_id: company.id,
      title: 'Architect Cloudflare D1 & KV edge storage integration',
      description: 'Implement zero-server edge persistence with 100% free tier compliance and hourly TTL retention.',
      status: 'done',
      priority: 'urgent',
      assignee: user.username,
      creator: user.username,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      updated_at: new Date().toISOString(),
      due_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
      tags: ['Backend', 'Cloudflare', 'Security'],
    },
    {
      id: 'TS-102',
      company_id: company.id,
      title: 'Build Pyodide WebAssembly POSIX Linux execution sandbox',
      description: 'Integrate full CPython 3.12 with standard libraries, pip micropip package installer, and real POSIX file ops.',
      status: 'done',
      priority: 'high',
      assignee: user.username,
      creator: user.username,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      updated_at: new Date().toISOString(),
      due_date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
      tags: ['Linux', 'WebAssembly', 'Python'],
    },
    {
      id: 'TS-103',
      company_id: company.id,
      title: 'Enforce private DM permissions & POSIX ACL user boundaries',
      description: 'Ensure personal DMs and user home folders (/home/<user>) cannot be read or traversed by unauthorized team members.',
      status: 'done',
      priority: 'urgent',
      assignee: user.username,
      creator: user.username,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Security', 'ACL', 'Permissions'],
    },
    {
      id: 'TS-104',
      company_id: company.id,
      title: 'Implement shared Jira-style Task Board & Localhost Web Browser',
      description: 'Create Jira Kanban board synced to /workspace/tasks and in-system browser tab for localhost and web preview.',
      status: 'in_progress',
      priority: 'high',
      assignee: user.username,
      creator: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Frontend', 'Kanban', 'Browser'],
    },
  ], [company.id, user.username]);

  const [tasks, setTasks] = useState<TaskItem[]>(defaultTasks);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  
  // Modal State
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newStatus, setNewStatus] = useState<TaskStatus>('todo');
  const [newAssignee, setNewAssignee] = useState(user.username);
  const [newDueDate, setNewDueDate] = useState('');
  const [newTags, setNewTags] = useState('Core, Feature');

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

    // Also mirror readable Markdown Board (KANBAN.md)
    let md = `# TheySynced Jira Task Board (${company.name})\nLast Updated: ${new Date().toISOString()}\n\n`;
    COLUMNS.forEach((col) => {
      const colTasks = updatedTasks.filter((t) => t.status === col.id);
      md += `## ${col.label.toUpperCase()} (${colTasks.length})\n`;
      if (colTasks.length === 0) {
        md += `*(No tasks)*\n\n`;
      } else {
        colTasks.forEach((t) => {
          md += `- **[${t.id}]** ${t.title} (Priority: ${t.priority.toUpperCase()} | Assignee: @${t.assignee})\n  > ${t.description}\n`;
        });
        md += `\n`;
      }
    });

    await onSaveAsset({
      id: `tasks_kanban_md_${company.id}`,
      company_id: company.id,
      asset_type: 'file',
      name: 'KANBAN.md',
      folder_path: '/workspace/tasks',
      content: md,
      size: md.length,
      created_by: 'system',
      updated_at: new Date().toISOString(),
      scope: 'shared',
    });

    // Broadcast over WebSocket
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({
        type: 'tasks_update',
        company_id: company.id,
        tasks: updatedTasks,
      }));
    }
  };

  // Move Task Status
  const handleMoveTask = async (taskId: string, targetStatus: TaskStatus) => {
    const updated = tasks.map((t) => (t.id === taskId ? { ...t, status: targetStatus, updated_at: new Date().toISOString() } : t));
    await saveTasks(updated);
  };

  // Delete Task
  const handleDeleteTask = async (taskId: string) => {
    const updated = tasks.filter((t) => t.id !== taskId);
    await saveTasks(updated);
  };

  // Create Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const nextNumber = tasks.length + 101;
    const newTask: TaskItem = {
      id: `TS-${nextNumber}`,
      company_id: company.id,
      title: newTitle.trim(),
      description: newDesc.trim() || 'No description provided.',
      status: newStatus,
      priority: newPriority,
      assignee: newAssignee || user.username,
      creator: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      due_date: newDueDate || undefined,
      tags: newTags.split(',').map((s) => s.trim()).filter(Boolean),
    };

    const updated = [newTask, ...tasks];
    await saveTasks(updated);

    setNewTitle('');
    setNewDesc('');
    setNewPriority('medium');
    setNewStatus('todo');
    setNewDueDate('');
    setShowNewTaskModal(false);
  };

  // Export Tasks to CSV
  const handleExportCsv = () => {
    const headers = ['ID', 'Title', 'Description', 'Status', 'Priority', 'Assignee', 'Creator', 'Due Date', 'Tags'];
    const rows = tasks.map((t) => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      `"${t.description.replace(/"/g, '""')}"`,
      t.status,
      t.priority,
      t.assignee,
      t.creator,
      t.due_date || '',
      `"${(t.tags || []).join(';')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks_${company.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`;
    a.click();
  };

  // Filter Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesDesc = t.description.toLowerCase().includes(q);
        const matchesId = t.id.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesId) return false;
      }
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      if (filterAssignee !== 'all' && t.assignee.toLowerCase() !== filterAssignee.toLowerCase()) return false;
      return true;
    });
  }, [tasks, searchQuery, filterPriority, filterAssignee]);

  const getPriorityBadge = (p: TaskPriority) => {
    switch (p) {
      case 'urgent':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">Urgent</span>;
      case 'high':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">High</span>;
      case 'medium':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">Medium</span>;
      case 'low':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Low</span>;
    }
  };

  const membersList = useMemo(() => {
    const list = [user.username];
    (company.members || []).forEach((m) => {
      if (!list.includes(m.username)) list.push(m.username);
    });
    return list;
  }, [company.members, user.username]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFAF8] overflow-hidden font-sans">
      
      {/* Header Bar */}
      <header className="px-6 py-4 bg-white border-b border-black/[0.04] flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-50 rounded-2xl text-blue-600 border border-blue-100 shadow-sm">
            <CheckSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-black text-slate-900 tracking-tight">Jira Tasks & Engineering Kanban</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {tasks.length} Issues
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Mounted at <span className="text-blue-600 font-semibold">/workspace/tasks/tasks.json</span> &bull; Synchronized with Linux OS
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('terminal', '/workspace/tasks')}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
              title="Inspect tasks in Linux Terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Terminal CLI</span>
            </button>
          )}

          <button
            onClick={handleExportCsv}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95"
            title="Download Tasks as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setShowNewTaskModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Issue</span>
          </button>
        </div>
      </header>

      {/* Filter and Search Bar */}
      <div className="px-6 py-3 bg-white/70 backdrop-blur-sm border-b border-black/[0.03] flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tasks, TS-ID, keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Assignees</option>
            {membersList.map((m) => (
              <option key={m} value={m}>@{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Kanban Board 5 Columns */}
      <div className="flex-1 p-6 overflow-x-auto overflow-y-hidden">
        <div className="flex space-x-4 h-full min-w-[1200px]">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                className={`flex-1 flex flex-col rounded-3xl border ${col.color} p-3.5 h-full overflow-hidden shadow-sm`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 mb-2 border-b border-black/[0.04] shrink-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-xs text-slate-800 tracking-wide uppercase">{col.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${col.countColor}`}>
                      {colTasks.length}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setNewStatus(col.id);
                      setShowNewTaskModal(true);
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-all"
                    title={`Add task to ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {colTasks.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-200 rounded-2xl text-slate-400 text-xs">
                      <span>No issues in {col.label}</span>
                    </div>
                  ) : (
                    colTasks.map((t) => (
                      <div
                        key={t.id}
                        className="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-mono text-[10px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                              {t.id}
                            </span>
                            {getPriorityBadge(t.priority)}
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 leading-snug mb-1">
                            {t.title}
                          </h4>
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mb-2.5">
                            {t.description}
                          </p>

                          {/* Tags */}
                          {t.tags && t.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2.5">
                              {t.tags.map((tag) => (
                                <span key={tag} className="text-[9px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Card Footer with Quick Move Actions */}
                        <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                          <div className="flex items-center space-x-1.5">
                            <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">
                              {t.assignee.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-[10px] font-semibold text-slate-700">@{t.assignee}</span>
                          </div>

                          {/* Quick Status Mover */}
                          <div className="flex items-center space-x-1">
                            <select
                              value={t.status}
                              onChange={(e) => handleMoveTask(t.id, e.target.value as TaskStatus)}
                              className="text-[10px] font-bold bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-slate-700 focus:outline-none cursor-pointer"
                            >
                              <option value="backlog">Backlog</option>
                              <option value="todo">To Do</option>
                              <option value="in_progress">In Progress</option>
                              <option value="review">Review</option>
                              <option value="done">Done</option>
                            </select>
                            <button
                              onClick={() => handleDeleteTask(t.id)}
                              className="p-1 text-slate-300 hover:text-rose-600 rounded"
                              title="Delete Task"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Issue Modal */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 mb-1">Create New Issue (Jira)</h3>
            <p className="text-xs text-slate-500 mb-4">
              Issue will be synchronized into <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">/workspace/tasks/tasks.json</code>
            </p>

            <form onSubmit={handleCreateTask} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Issue Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Implement OAuth2 Refresh Token Rotation"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description / Acceptance Criteria</label>
                <textarea
                  rows={3}
                  placeholder="Explain requirements, test steps, or background context..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Initial Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">In Review</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assignee</label>
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                  >
                    {membersList.map((m) => (
                      <option key={m} value={m}>@{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tags (Comma-separated)</label>
                  <input
                    type="text"
                    placeholder="Backend, API, Security"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-md"
                >
                  Create Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
