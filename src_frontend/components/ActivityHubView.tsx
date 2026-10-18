'use client';

import React, { useState, useEffect } from 'react';
import { Company, UserProfile, CompanyMember, CompanyRole } from '../types';
import { Activity, ShieldAlert, Ban, Clock, Search, Shield, ChevronDown } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { ConfirmModal } from './ConfirmModal';

interface ActivityHubViewProps {
  user: UserProfile;
  company: Company;
  token: string;
  onCompanyUpdated: (updatedCompany: Company) => void;
}

interface DailyData {
  day: string;
  hours: number;
}

export const ActivityHubView: React.FC<ActivityHubViewProps> = ({
  user,
  company,
  token,
  onCompanyUpdated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [screenSeconds, setScreenSeconds] = useState(0);
  const [kickingUserId, setKickingUserId] = useState<string | null>(null);
  const [kickDuration, setKickDuration] = useState('5'); // minutes
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedUserForGraph, setSelectedUserForGraph] = useState<string>(user.id);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; day: string; hours: number } | null>(null);

  // Track user active screen seconds
  useEffect(() => {
    const saved = localStorage.getItem('theysynced_active_seconds');
    if (saved) {
      setScreenSeconds(parseInt(saved, 10));
    }

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        setScreenSeconds((prev) => {
          const next = prev + 1;
          localStorage.setItem('theysynced_active_seconds', next.toString());
          return next;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const isAdmin = company.members?.some(
    (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
  ) || company.owner_id === user.id;

  // Moderators can also kick/ban/change roles (but not assign Admin or above)
  const canModerate = isAdmin || company.members?.some(
    (m) => m.user_id === user.id && m.role === 'Moderator'
  );

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(null);
      }
    });
  };

  // Get actual tracked daily screen time data for member
  const getWeeklyTrendForMember = (member: CompanyMember): DailyData[] => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    return days.map((day) => {
      let seconds = 0;
      if (member.daily_active_seconds && member.daily_active_seconds[day] !== undefined) {
        seconds = member.daily_active_seconds[day];
      }
      
      // If it is the current user, merge with active frontend screenSeconds state
      if (member.user_id === user.id) {
        const currentDayName = new Date().toLocaleDateString('en-US', { weekday: 'short' }); // e.g. "Wed"
        if (day === currentDayName) {
          const otherDaysSum = Object.entries(member.daily_active_seconds || {})
            .filter(([d]) => d !== currentDayName)
            .reduce((sum, [_, sec]) => sum + sec, 0);
          
          seconds = Math.max(0, screenSeconds - otherDaysSum);
        }
      }

      const hours = parseFloat((seconds / 3600).toFixed(2));
      return { day, hours };
    });
  };

  const getScreenHoursForMember = (member: CompanyMember): number => {
    if (member.user_id === user.id) {
      return parseFloat((screenSeconds / 3600).toFixed(2));
    }
    return parseFloat(((member.total_active_seconds || 0) / 3600).toFixed(2));
  };

  const membersWithActivity = (company.members || [])
    .map((m) => ({
      ...m,
      hours: getScreenHoursForMember(m),
    }))
    .sort((a, b) => b.hours - a.hours);

  const filteredMembers = (company.members || []).filter((m) =>
    m.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleKick = (targetUserId: string) => {
    const targetMember = company.members?.find((m) => m.user_id === targetUserId);
    triggerConfirm(
      'Kick Member',
      `Are you sure you want to kick @${targetMember?.username || 'this member'}?`,
      async () => {
        setActionMessage(null);
        try {
          const res = await fetch('/api/companies/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              company_id: company.id,
              target_user_id: targetUserId,
              duration_mins: parseInt(kickDuration, 10),
            }),
          });
          const data = await res.json();
          if (data.success && data.company) {
            onCompanyUpdated(data.company);
            setActionMessage({ type: 'success', text: 'Member kicked successfully.' });
            setKickingUserId(null);
          } else {
            setActionMessage({ type: 'error', text: data.message || 'Failed to kick member' });
          }
        } catch (e) {
          setActionMessage({ type: 'error', text: 'Network error kicking member' });
        }
      }
    );
  };

  const handleBan = (targetUserId: string) => {
    triggerConfirm(
      'Ban Member',
      'Are you sure you want to permanently ban this member? they will not be able to rejoin.',
      async () => {
        setActionMessage(null);
        try {
          const res = await fetch('/api/companies/ban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              company_id: company.id,
              target_user_id: targetUserId,
            }),
          });
          const data = await res.json();
          if (data.success && data.company) {
            onCompanyUpdated(data.company);
            setActionMessage({ type: 'success', text: 'Member permanently banned.' });
          } else {
            setActionMessage({ type: 'error', text: data.message || 'Failed to ban member' });
          }
        } catch (e) {
          setActionMessage({ type: 'error', text: 'Network error banning member' });
        }
      }
    );
  };

  // Handle role change for a member
  const handleRoleChange = async (targetUserId: string, newRole: CompanyRole) => {
    try {
      const res = await fetch('/api/companies/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          company_id: company.id,
          target_user_id: targetUserId,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (data.success && data.company) {
        onCompanyUpdated(data.company);
        setActionMessage({ type: 'success', text: `Role updated to ${newRole}.` });
      } else {
        setActionMessage({ type: 'error', text: data.message || 'Failed to update role' });
      }
    } catch (e) {
      setActionMessage({ type: 'error', text: 'Network error updating role' });
    }
  };

  // Find selected user's trend data for the real SVG graph

  const selectedMemberObj = company.members?.find(m => m.user_id === selectedUserForGraph) || {
    user_id: user.id,
    username: user.username,
    role: 'Member' as const,
    joined_at: '',
    avatar_url: user.avatar_url,
    total_active_seconds: user.total_active_seconds,
    daily_active_seconds: user.daily_active_seconds as any,
  };
  const currentTrendData = getWeeklyTrendForMember(selectedMemberObj);

  // SVG Chart sizing & mapping helpers
  const svgWidth = 520;
  const svgHeight = 220;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const maxVal = Math.max(...currentTrendData.map(d => d.hours), 5); // scale to max or minimum of 5 hours

  const points = currentTrendData.map((d, idx) => {
    const x = paddingLeft + (idx / 6) * chartWidth;
    const y = paddingTop + chartHeight - (d.hours / maxVal) * chartHeight;
    return { x, y, day: d.day, hours: d.hours };
  });

  // SVG path definitions
  const linePath = points.map((p, idx) => (idx === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/[0.06] flex items-center justify-between bg-white z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Activity Hub & Governance</h2>
            <p className="text-[11px] text-slate-400 font-light">Screen engagement analytics & member authorization</p>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className={`mx-6 mt-4 p-3 rounded-2xl text-xs font-semibold ${
          actionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
        }`}>
          {actionMessage.text}
        </div>
      )}

      {/* Main split dashboard view with stretch grid to keep both cards the same size */}
      <div className="flex-1 p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch min-h-0">
        
        {/* Left Column: Screen Activity Analytics Graph (Real SVG chart) */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Engagement Trend</h3>
                <p className="text-[10px] text-slate-400">Daily active screen hours logged this week</p>
              </div>
              
              {/* User Selector Dropdown for Graph */}
              <div className="relative">
                <select
                  value={selectedUserForGraph}
                  onChange={(e) => setSelectedUserForGraph(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-600 bg-slate-50/50 cursor-pointer text-slate-700 font-medium"
                >
                  {company.members?.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      @{m.username} {m.user_id === user.id ? '(You)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2 pointer-events-none" />
              </div>
            </div>

            {/* Real Interactive SVG Area Chart */}
            <div className="relative w-full h-64 bg-slate-50/60 rounded-2xl border border-slate-100 flex items-center justify-center p-2">
              <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="overflow-visible select-none">
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Y-axis Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
                  const y = paddingTop + ratio * chartHeight;
                  const value = ((1.0 - ratio) * maxVal).toFixed(1);
                  return (
                    <g key={idx} className="opacity-40">
                      <line x1={paddingLeft} y1={y} x2={svgWidth - paddingRight} y2={y} stroke="#cbd5e1" strokeDasharray="3,3" />
                      <text x={paddingLeft - 10} y={y + 4} textAnchor="end" className="text-[10px] fill-slate-400 font-mono font-medium">{value}h</text>
                    </g>
                  );
                })}

                {/* X-axis days labels */}
                {points.map((p, idx) => (
                  <text key={idx} x={p.x} y={paddingTop + chartHeight + 20} textAnchor="middle" className="text-[10px] fill-slate-400 font-semibold">
                    {p.day}
                  </text>
                ))}

                {/* Area Gradient Fill */}
                <path d={areaPath} fill="url(#chartGrad)" />

                {/* Spline Path */}
                <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" />

                {/* Data Points / Interaction dots */}
                {points.map((p, idx) => {
                  const isHovered = hoveredPoint && hoveredPoint.day === p.day;
                  return (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={isHovered ? 6 : 4}
                      fill={isHovered ? '#4f46e5' : '#ffffff'}
                      stroke="#4f46e5"
                      strokeWidth="2.5"
                      onMouseEnter={() => setHoveredPoint(p)}
                      onMouseLeave={() => setHoveredPoint(null)}
                      className="cursor-pointer transition-all duration-150"
                    />
                  );
                })}
              </svg>

              {/* Real-time Hover Tooltip */}
              {hoveredPoint && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(hoveredPoint.x / svgWidth) * 90}%`,
                    top: `${(hoveredPoint.y / svgHeight) * 75}%`,
                  }}
                  className="bg-slate-900/90 backdrop-blur-xs text-white px-3 py-1.5 rounded-xl text-[10px] font-bold shadow-xl border border-slate-700/50 pointer-events-none transition-all duration-100"
                >
                  <div className="font-semibold text-slate-300">{hoveredPoint.day}</div>
                  <div className="text-white mt-0.5">{hoveredPoint.hours.toFixed(1)} hours</div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span>Graph shows weekly breakdown.</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <span>Active Screen Tracking: {(screenSeconds / 3600).toFixed(2)}h</span>
            </div>
          </div>
        </div>

        {/* Right Column: User Management / Member Authorization */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md p-6 flex flex-col justify-between">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Member Directory</h3>
                <p className="text-[10px] text-slate-400">View co-workers and manage organization members</p>
              </div>
              <Shield className="w-4 h-4 text-indigo-500" />
            </div>

            {/* Search Box */}
            <div className="relative mb-4">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-600 bg-slate-50/50"
              />
            </div>

            {/* Members List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px]">
              {filteredMembers.map((m) => {
                const isTargetAdmin = m.role === 'Owner' || m.role === 'Admin';
                // Moderators can't target Admins or other Moderators, only Admins can
                const isTargetProtected = isTargetAdmin || (!isAdmin && m.role === 'Moderator');
                const canAction = canModerate && m.user_id !== user.id && !isTargetProtected;
                return (
                  <div key={m.user_id} className="p-3 rounded-2xl border border-slate-100 bg-slate-50/50 flex items-center justify-between transition-all">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <UserAvatar seed={m.username} size={28} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">@{m.username}</div>
                        <div className="text-[10px] text-slate-400 capitalize">{m.role}</div>
                      </div>
                    </div>

                    {/* ONLY admins/moderators see action buttons or protected status labels */}
                    {canModerate && (
                      canAction ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Role dropdown — Moderators can only assign Member/Guest */}
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.user_id, e.target.value as CompanyRole)}
                            className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer"
                          >
                            <option value="Guest">Guest (Read-only)</option>
                            <option value="Member">Member</option>
                            {isAdmin && <option value="Moderator">Moderator</option>}
                            {isAdmin && <option value="Admin">Admin</option>}
                          </select>
                          <button
                            onClick={() => setKickingUserId(m.user_id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1"
                          >
                            <Clock className="w-3 h-3" />
                            <span>Kick</span>
                          </button>
                          <button
                            onClick={() => handleBan(m.user_id)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Ban</span>
                          </button>
                        </div>
                      ) : (
                        <div className="px-2.5 py-1 bg-slate-100 text-slate-400 rounded-lg text-[10px] font-semibold flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          <span>Protected</span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-[10px] text-slate-400 font-medium">
            {isAdmin ? 'You are viewing member controls as Administrator.' : canModerate ? 'You are viewing member controls as Moderator.' : 'Viewing member directories.'}
          </div>
        </div>

      </div>

      {/* Kick Duration Picker Dialog Overlay */}
      {kickingUserId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl max-w-sm w-full space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="w-5 h-5" />
              <h4 className="text-sm font-bold">Temporarily Kick Member</h4>
            </div>
            <p className="text-xs text-slate-500">Select how long this user should be locked out of the company workspace before they can rejoin.</p>
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">Duration</label>
              <select
                value={kickDuration}
                onChange={(e) => setKickDuration(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-600 bg-slate-50/50"
              >
                <option value="5">5 Minutes</option>
                <option value="60">1 Hour</option>
                <option value="1440">24 Hours</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setKickingUserId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleKick(kickingUserId)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all"
              >
                Confirm Kick
              </button>
            </div>
          </div>
        </div>
      )}

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
