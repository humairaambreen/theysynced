'use client';

import React, { useState, useEffect } from 'react';
import { ChatMessage, Company, Team, UserProfile } from '../types';
import { Send, Hash, Plus, Trash2, MessageSquare, Users, Check, Phone, PhoneOff, Mic, MicOff, Volume2, Paperclip, Smile, MoreHorizontal, CornerUpLeft, X, HardDrive, Download, ChevronLeft } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { ConfirmModal } from './ConfirmModal';

interface ChatViewProps {
  user: UserProfile;
  company: Company;
  teams: Team[];
  messages: ChatMessage[];
  onSendMessage: (text: string, teamId?: string, attachment?: any) => void;
  onCreateTeam: (name: string, description: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  onStartCall?: () => void;
  selectedTeamId?: string;
  onSelectTeam?: (teamId: string) => void;
  websocket?: WebSocket | null;
}

const getRelativePresenceStatus = (lastActiveAt?: string) => {
  if (!lastActiveAt) return { isOnline: false, text: 'Offline' };

  const lastActiveDate = new Date(lastActiveAt);
  const now = new Date();
  const diffMs = now.getTime() - lastActiveDate.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMins < 1) {
    return { isOnline: true, text: 'Active now' };
  } else if (diffMins < 60) {
    return { isOnline: false, text: `Active ${diffMins}m ago` };
  } else {
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return { isOnline: false, text: `Active ${diffHours}h ago` };
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return { isOnline: false, text: `Active ${diffDays}d ago` };
    }
  }
};

interface ActiveCall {
  teamId: string;
  participants: string[];
  isMuted: boolean;
  status: 'ringing' | 'connected';
}

export const ChatView: React.FC<ChatViewProps> = ({
  user,
  company,
  teams,
  messages,
  onSendMessage,
  onCreateTeam,
  onDeleteTeam,
  selectedTeamId,
  onSelectTeam,
  websocket,
}) => {
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [tick, setTick] = useState(0);
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>('sidebar');

  useEffect(() => {
    if (selectedTeam) {
      setMobileView('chat');
    } else {
      setMobileView('sidebar');
    }
  }, [selectedTeam?.id]);

  // Unread message tracking state
  const [lastSeenTimestamps, setLastSeenTimestamps] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(`chat_last_seen_${user.id}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Automatically mark current channel as read when opened or when new messages arrive
  useEffect(() => {
    if (selectedTeam) {
      const channelMsgs = messages.filter((m) => m.team_id === selectedTeam.id);
      if (channelMsgs.length > 0) {
        const latestTime = channelMsgs[channelMsgs.length - 1].timestamp;
        setLastSeenTimestamps((prev) => {
          const updated = { ...prev, [selectedTeam.id]: latestTime };
          localStorage.setItem(`chat_last_seen_${user.id}`, JSON.stringify(updated));
          return updated;
        });
      } else {
        setLastSeenTimestamps((prev) => {
          const updated = { ...prev, [selectedTeam.id]: new Date().toISOString() };
          localStorage.setItem(`chat_last_seen_${user.id}`, JSON.stringify(updated));
          return updated;
        });
      }
    }
  }, [selectedTeam, messages, user.id]);

  const getUnreadCount = (channelId: string) => {
    if (selectedTeam && selectedTeam.id === channelId) return 0;
    const lastSeen = lastSeenTimestamps[channelId] || '0';
    const channelMsgs = messages.filter(
      (m) => m.team_id === channelId && m.user_id !== user.id
    );
    return channelMsgs.filter((m) => m.timestamp > lastSeen).length;
  };

  const isAdmin = (company.members || []).some(
    (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
  ) || company.owner_id === user.id;

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

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedTeamId) {
      const found = teams.find((t) => t.id === selectedTeamId);
      if (found) {
        setSelectedTeam(found);
        return;
      }
    }
    const genTeam = teams.find((t) => t.name.toLowerCase() === 'general') || teams[0];
    if (genTeam) {
      setSelectedTeam(genTeam);
      onSelectTeam?.(genTeam.id);
    } else {
      setSelectedTeam(null);
    }
  }, [selectedTeamId, teams]);


  const [inputMessage, setInputMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Rich Chat States
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`hidden_msgs_${user.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState<any | null>(null);
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const [activeReactionSelectorId, setActiveReactionSelectorId] = useState<string | null>(null);

  const hideMessageLocally = (msgId: string) => {
    const updated = [...hiddenMessageIds, msgId];
    setHiddenMessageIds(updated);
    localStorage.setItem(`hidden_msgs_${user.id}`, JSON.stringify(updated));
    setActiveMessageMenuId(null);
  };

  const handleAddReaction = (msgId: string, emoji: string) => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({
        type: 'reaction',
        message_id: msgId,
        emoji: emoji,
        channel_id: activeTeamId
      }));
    }
    setActiveReactionSelectorId(null);
  };

  const handleDeleteMessageForEveryone = (msgId: string) => {
    triggerConfirm(
      'Delete Message',
      'Are you sure you want to delete this message for everyone? This action cannot be undone.',
      () => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({
            type: 'delete_message',
            message_id: msgId,
            channel_id: activeTeamId
          }));
        }
      }
    );
    setActiveMessageMenuId(null);
  };

  const scrollToAndHighlightMessage = (msgId: string) => {
    if (!msgId) return;
    const element = document.getElementById(`msg-${msgId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add highlight classes
      element.classList.add('bg-indigo-50/80', 'ring-2', 'ring-indigo-500/20', 'scale-[1.01]');
      // Remove highlight classes after 2 seconds
      setTimeout(() => {
        element.classList.remove('bg-indigo-50/80', 'ring-2', 'ring-indigo-500/20', 'scale-[1.01]');
      }, 2000);
    }
  };

  const parseReply = (text: string) => {
    if (text.startsWith('>> @') && text.includes('\n')) {
      const firstLineIdx = text.indexOf('\n');
      const firstLine = text.substring(4, firstLineIdx);
      const rest = text.substring(firstLineIdx + 1);
      const colonIdx = firstLine.indexOf(':');
      if (colonIdx !== -1) {
        const header = firstLine.substring(0, colonIdx);
        const replyText = firstLine.substring(colonIdx + 1).trim();
        
        let replyUser = header;
        let replyMsgId = '';
        let finalReplyText = replyText;
        if (header.includes(' [id:')) {
          const parts = header.split(' [id:');
          replyUser = parts[0].trim();
          replyMsgId = parts[1].replace(']', '').trim();
        } else if (header.includes('|id')) {
          const parts = header.split('|id');
          replyUser = parts[0].trim();
          const textColonIdx = replyText.indexOf(':');
          if (textColonIdx !== -1) {
            replyMsgId = replyText.substring(0, textColonIdx).trim();
            finalReplyText = replyText.substring(textColonIdx + 1).trim();
          }
        }
        
        return { hasReply: true, replyUser, replyMsgId, replyText: finalReplyText, rest };
      }
    }
    return { hasReply: false, replyUser: '', replyMsgId: '', replyText: '', rest: text };
  };

  // In-Chat Voice Call States
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isRingingIncoming, setIsRingingIncoming] = useState(false);
  const [callerName, setCallerName] = useState('');
  const [ringtoneAudio, setRingtoneAudio] = useState<HTMLAudioElement | null>(null);

  // Separate teams into Group Channels vs Direct Messages
  const channelTeams = teams.filter((t) => !t.name.startsWith('DM:') && !t.name.startsWith('DM with @') && !t.name.startsWith('DM @'));
  const activeTeamId = selectedTeam?.id;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() && !uploadingAttachment) return;
    
    let textToSend = inputMessage.trim();
    if (replyToMessage) {
      textToSend = `>> @${replyToMessage.username}|id:${replyToMessage.id}: ${replyToMessage.message.replace(/\n/g, ' ')}\n${textToSend}`;
    }

    onSendMessage(textToSend, activeTeamId, uploadingAttachment);
    setInputMessage('');
    setReplyToMessage(null);
    setUploadingAttachment(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result as string;
      setUploadingAttachment({
        name: file.name,
        url: b64,
        file_type: file.type || 'application/octet-stream',
        size: file.size,
      });

      try {
        const uploadRes = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            file_type: file.type || 'application/octet-stream',
            data_base64: b64,
          }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success && uploadData.url) {
          setUploadingAttachment({
            name: uploadData.name,
            url: uploadData.url,
            file_type: uploadData.file_type,
            size: uploadData.size,
          });
        }
      } catch (err) {
        console.warn('Storage upload fallback to inline data:', err);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset file input
  };

  const handleStartDMWithUser = (targetUsername: string) => {
    // Sort usernames alphabetically to ensure symmetric unique DM channel naming
    const sorted = [user.username, targetUsername].sort();
    const dmTeamName = `DM:${sorted[0]}-${sorted[1]}`;
    const desc = targetUsername === user.username
      ? 'Personal notebook & saved messages'
      : `Direct 1-on-1 messaging between @${sorted[0]} and @${sorted[1]}`;

    const existing = teams.find((t) => t.name === dmTeamName);
    if (existing) {
      setSelectedTeam(existing);
      onSelectTeam?.(existing.id);
    } else {
      onCreateTeam(dmTeamName, desc);
    }
  };


  const handleUserToggle = (username: string) => {
    setSelectedUsers((prev) =>
      prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]
    );
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUsers.length === 0) return;

    if (selectedUsers.length === 1) {
      handleStartDMWithUser(selectedUsers[0]);
    } else {
      const name = newTeamName.trim() || selectedUsers.join(', ');
      const desc = newTeamDesc.trim() || `Group conversation with ${selectedUsers.join(', ')}`;
      onCreateTeam(name, desc);
    }

    setSelectedUsers([]);
    setNewTeamName('');
    setNewTeamDesc('');
    setShowModal(false);
  };

  // Trigger calling / ringing
  const startCall = () => {
    if (!activeTeamId) return;
    setActiveCall({
      teamId: activeTeamId,
      participants: [user.username],
      isMuted: false,
      status: 'connected',
    });

    // Send a message log
    onSendMessage(`📞 Started a voice call. Click "Join Call" at the top to connect!`, activeTeamId);
  };

  const joinCall = () => {
    if (!activeCall) return;
    if (activeCall.participants.includes(user.username)) return;
    setActiveCall({
      ...activeCall,
      participants: [...activeCall.participants, user.username],
    });
  };

  const leaveCall = () => {
    if (!activeCall) return;
    const remaining = activeCall.participants.filter(p => p !== user.username);
    if (remaining.length === 0) {
      // Call ended
      onSendMessage(`📞 Call ended.`, activeCall.teamId);
      setActiveCall(null);
    } else {
      setActiveCall({
        ...activeCall,
        participants: remaining,
      });
    }
  };

  const toggleMute = () => {
    if (!activeCall) return;
    setActiveCall({
      ...activeCall,
      isMuted: !activeCall.isMuted,
    });
  };

  const filteredMembers = (company.members || []).filter((m) =>
    m.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isGeneralChannel = selectedTeam?.name.toLowerCase() === 'general' || (activeTeamId?.endsWith('_gen') ?? false);
  const filteredMessages = messages.filter((m) => {
    if (hiddenMessageIds.includes(m.id)) return false;
    if (m.team_id) {
      return m.team_id === activeTeamId || (isGeneralChannel && (m.team_id === company.id || m.team_id === `team_${company.id}_gen`));
    }
    // Messages without team_id belong to General/company chat
    return isGeneralChannel || activeTeamId === company.id;
  });

  return (
    <div className="h-full w-full flex bg-white overflow-hidden font-sans select-none">
      
      {/* Channels & DMs Left Sidebar */}
      <div className={`w-full lg:w-64 bg-slate-50 border-r border-black/[0.04] p-4 flex flex-col justify-between shrink-0 ${mobileView === 'chat' ? 'hidden lg:flex' : 'flex'}`}>
        <div className="space-y-6 overflow-y-auto pr-1">
          
          {/* GROUP CHANNELS SECTION */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 text-slate-400">
              <span className="text-[11px] font-extrabold uppercase tracking-wider">Group Channels</span>
              <button
                onClick={() => {
                  setSelectedUsers([]);
                  setShowModal(true);
                }}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                title="Create Conversation"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              {channelTeams.map((t) => {
                const isActive = activeTeamId === t.id;
                const unreadCount = getUnreadCount(t.id);
                return (
                  <div key={t.id} className="group relative flex items-center">
                    <button
                      onClick={() => {
                        setSelectedTeam(t);
                        onSelectTeam?.(t.id);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center space-x-2 transition-all ${
                        isActive
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                      }`}
                    >
                      <Hash className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-300' : 'text-slate-400'}`} />
                      <span className="truncate flex-1 text-left">{t.name}</span>
                      {unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] font-extrabold bg-rose-500 text-white rounded-full min-w-[18px] text-center shadow-sm animate-pulse shrink-0">
                          {unreadCount}
                        </span>
                      )}
                    </button>


                    {onDeleteTeam && teams.length > 1 && isAdmin && t.name.toLowerCase() !== 'general' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerConfirm(
                            'Delete Channel',
                            `Are you sure you want to delete the channel "#${t.name}"? This action cannot be undone.`,
                            () => {
                              onDeleteTeam(t.id);
                              if (activeTeamId === t.id) {
                                setSelectedTeam(teams.find((x) => x.id !== t.id) || null);
                              }
                            }
                          );
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all absolute right-2"
                        title="Delete Channel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* DIRECT MESSAGES SECTION */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 text-slate-400">
              <span className="text-[11px] font-extrabold uppercase tracking-wider">Direct Messages</span>
              <button
                onClick={() => {
                  setSelectedUsers([]);
                  setShowModal(true);
                }}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                title="New DM"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              {company.members && company.members.length > 0 ? (
                company.members.map((m) => {
                  const isSelf = m.username === user.username;
                  const sorted = [user.username, m.username].sort();
                  const dmTeamName = `DM:${sorted[0]}-${sorted[1]}`;
                  const teamObj = teams.find((t) => t.name === dmTeamName);
                  const isActive = selectedTeam?.id === teamObj?.id;
                  const presence = getRelativePresenceStatus(m.last_active_at);
                  const unreadCount = teamObj ? getUnreadCount(teamObj.id) : 0;

                  return (
                    <button
                      key={m.user_id}
                      onClick={() => handleStartDMWithUser(m.username)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center space-x-3 transition-all ${
                        isActive
                          ? 'bg-slate-950 text-white shadow-sm'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <div className="relative">
                        <UserAvatar seed={m.username} avatarUrl={m.avatar_url} size={28} />
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-white ${
                          presence.isOnline ? 'bg-emerald-400' : 'bg-slate-300'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-bold">
                          {isSelf ? `@${m.username} (You)` : `@${m.username}`}
                        </div>
                        <div className={`text-[10px] truncate ${isActive ? 'text-slate-400' : 'text-slate-400 font-light'}`}>
                          {presence.text}
                        </div>
                      </div>
                      {unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] font-extrabold bg-rose-500 text-white rounded-full min-w-[18px] text-center shadow-sm animate-pulse shrink-0">
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="text-[11px] text-slate-400 px-3 py-2">No co-workers online</div>
              )}
            </div>
          </div>

        </div>

        <div className="pt-4 border-t border-slate-200 text-[10px] text-slate-400 flex items-center justify-between">
          <span>Company: <strong className="text-slate-700">{company.name}</strong></span>
        </div>
      </div>

      {/* Main Conversation Feed */}
      <div className={`flex-1 flex flex-col h-full bg-white relative min-w-0 ${mobileView === 'sidebar' ? 'hidden lg:flex' : 'fixed inset-0 z-50 flex lg:relative lg:inset-auto lg:z-0 animate-slide-in'}`}>
        {!selectedTeam ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#F8F9FB] p-8 text-center animate-in fade-in duration-300">
            <div className="w-16 h-16 rounded-3xl bg-indigo-50/80 text-indigo-600 flex items-center justify-center shadow-sm mb-6 animate-pulse">
              <MessageSquare className="w-7 h-7 stroke-[1.5]" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight font-sans">
              Welcome to Teams & Chat
            </h2>
            <p className="mt-2 text-slate-500 text-xs max-w-sm font-light leading-relaxed">
              Select a group channel or start a direct message with any co-worker from the sidebar to begin collaborating in real-time.
            </p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md w-full">
              <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm text-left">
                <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  Group Channels
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-light leading-normal">Create projects or general forums to keep your team synchronized in one space.</p>
              </div>

              <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm text-left">
                <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Direct Messages
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-light leading-normal">Message teammates privately, write personal notes, or start voice calls instantly.</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 py-3.5 border-b border-black/[0.04] flex items-center justify-between bg-white z-10">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setSelectedTeam(null);
                    onSelectTeam?.('');
                    setMobileView('sidebar');
                  }}
                  className="lg:hidden mr-1 p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
                  title="Back to channels"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                {selectedTeam?.name.startsWith('DM') ? (
                  (() => {
                    let targetUname = '';
                    if (selectedTeam.name.startsWith('DM:')) {
                      const parts = selectedTeam.name.replace('DM:', '').split('-');
                      targetUname = parts.find((u) => u !== user.username) || user.username;
                    } else {
                      targetUname = selectedTeam.name.replace('DM with @', '').replace('DM @', '').trim();
                    }
                    const dmMember = (company.members || []).find((mem) => mem.username === targetUname);
                    return <UserAvatar seed={targetUname} avatarUrl={dmMember?.avatar_url} size={36} />;
                  })()
                ) : (
                  <div className="w-9 h-9 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold">
                    <Hash className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedTeam?.name.startsWith('DM')
                      ? (() => {
                          let targetUname = '';
                          if (selectedTeam.name.startsWith('DM:')) {
                            const parts = selectedTeam.name.replace('DM:', '').split('-');
                            targetUname = parts.find((u) => u !== user.username) || user.username;
                          } else {
                            targetUname = selectedTeam.name.replace('DM with @', '').replace('DM @', '').trim();
                          }
                          return targetUname === user.username ? `@${user.username} (Note to Self)` : `@${targetUname}`;
                        })()
                      : selectedTeam ? selectedTeam.name : 'General'}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-light">
                    {selectedTeam?.name.startsWith('DM')
                      ? (() => {
                          let targetUname = '';
                          if (selectedTeam.name.startsWith('DM:')) {
                            const parts = selectedTeam.name.replace('DM:', '').split('-');
                            targetUname = parts.find((u) => u !== user.username) || user.username;
                          } else {
                            targetUname = selectedTeam.name.replace('DM with @', '').replace('DM @', '').trim();
                          }
                          return targetUname === user.username ? 'Personal notebook & saved messages' : `Direct 1-on-1 messaging with @${targetUname}`;
                        })()
                      : selectedTeam?.description || 'Real-time corporate messaging'}
                  </p>
                </div>
              </div>

              {/* In-Chat Call Trigger Button */}
              {!activeCall && (
                <button
                  onClick={startCall}
                  className="p-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-all"
                  title="Start Voice Call"
                >
                  <Phone className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Discord/Teams-style Active Voice Call Pane */}
            {activeCall && activeCall.teamId === activeTeamId && (
              <div className="px-6 py-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 animate-in slide-in-from-top duration-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-emerald-500 flex items-center justify-center text-white font-bold animate-pulse">
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                      <span>Active Voice Connection</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {activeCall.participants.length} connected: {activeCall.participants.join(', ')}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleMute}
                    className={`p-2 rounded-xl transition-all ${
                      activeCall.isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                    title={activeCall.isMuted ? 'Unmute' : 'Mute'}
                  >
                    {activeCall.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={leaveCall}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>
            )}

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {filteredMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <MessageSquare className="w-10 h-10 mb-2 stroke-[1.5]" />
                  <div className="text-xs font-bold text-slate-700">No messages here yet</div>
                  <p className="text-[10px] text-slate-400 max-w-[200px] mt-1">Send a message or start a voice call to get started.</p>
                </div>
              ) : (
                filteredMessages.map((m) => {
                  const isMe = m.user_id === user.id;
                  const isCallMsg = m.message.includes('📞');
                  const senderMember = (company.members || []).find((mem) => mem.user_id === m.user_id || mem.username === m.username);
                  const avatarUrl = senderMember?.avatar_url;
                  const { hasReply, replyUser, replyMsgId, replyText, rest } = parseReply(m.message);

                  if (hiddenMessageIds.includes(m.id)) {
                    return (
                      <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className="px-4 py-2 bg-slate-100 text-slate-400 text-[10px] rounded-2xl italic">
                          Message deleted for you
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      id={`msg-${m.id}`}
                      className={`group flex items-start space-x-3 transition-all duration-300 p-2 rounded-2xl relative ${
                        isMe ? 'flex-row-reverse space-x-reverse' : ''
                      }`}
                    >
                      <UserAvatar seed={m.username} avatarUrl={avatarUrl} size={36} />

                      <div className={`max-w-[70%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-[10px] font-bold text-slate-900">
                            {isMe ? `@${m.username} (You)` : `@${m.username}`}
                          </span>
                          <span className="text-[9px] text-slate-400 font-light">
                            {m.timestamp.slice(11, 16)}
                          </span>
                        </div>

                        <div
                          className={`p-3.5 rounded-3xl text-xs relative ${
                            isMe
                              ? 'bg-slate-950 text-white rounded-tr-none'
                              : 'bg-slate-100 text-slate-900 rounded-tl-none'
                          }`}
                        >
                          {hasReply && (
                            <button
                              onClick={() => replyMsgId && scrollToAndHighlightMessage(replyMsgId)}
                              className={`w-full text-left p-2.5 mb-2.5 rounded-2xl text-[10px] flex items-start space-x-2 border transition-all ${
                                isMe
                                  ? 'bg-white/10 hover:bg-white/15 border-white/10 text-slate-200'
                                  : 'bg-black/5 hover:bg-black/10 border-black/[0.05] text-slate-600'
                              }`}
                            >
                              <CornerUpLeft className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <div className="font-extrabold text-[9px] opacity-90 truncate">
                                  Replying to @{replyUser}
                                </div>
                                <div className="truncate opacity-75 mt-0.5 font-light">
                                  {replyText}
                                </div>
                              </div>
                            </button>
                          )}

                          <div className="whitespace-pre-wrap leading-relaxed break-words">{rest}</div>

                          {m.file_attachment && (
                            <div className={`mt-2 p-2.5 rounded-2xl border flex items-center justify-between gap-3 max-w-sm ${
                              isMe ? 'bg-black/25 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-800'
                            }`}>
                              <div className="flex items-center space-x-2 min-w-0">
                                {m.file_attachment.file_type.startsWith('image/') ? (
                                  <img
                                    src={m.file_attachment.url}
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200/20"
                                    alt={m.file_attachment.name}
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                                    <HardDrive className="w-3.5 h-3.5" />
                                  </div>
                                )}
                                <div className="text-left min-w-0">
                                  <div className="text-[11px] font-bold truncate max-w-[150px]">
                                    {m.file_attachment.name}
                                  </div>
                                  <div className="text-[9px] text-slate-400">
                                    {(m.file_attachment.size / 1024).toFixed(1)} KB
                                  </div>
                                </div>
                              </div>
                              <a
                                href={m.file_attachment.url}
                                download={m.file_attachment.name}
                                className={`p-1 rounded-full border transition-all ${
                                  isMe
                                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                                    : 'border-slate-200 hover:bg-slate-100 text-slate-500'
                                }`}
                              >
                                <Download className="w-3 h-3" />
                              </a>
                            </div>
                          )}

                          {/* Hover action selectors - positioned beautifully next to the bubble without page overflow */}
                          <div className={`absolute top-1/2 -translate-y-1/2 hidden group-hover/bubble:flex group-hover:flex items-center space-x-1 bg-white border border-slate-200/80 rounded-full px-2 py-1 shadow-md z-20 ${
                            isMe ? 'left-0 -translate-x-[105%]' : 'right-0 translate-x-[105%]'
                          }`}>
                            {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => handleAddReaction(m.id, emoji)}
                                className="text-[11px] hover:scale-125 transition-transform p-0.5"
                              >
                                {emoji}
                              </button>
                            ))}
                            <div className="w-px h-3 bg-slate-200 mx-0.5" />
                            <button
                              onClick={() => setReplyToMessage(m)}
                              className="p-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors"
                              title="Reply"
                            >
                              <CornerUpLeft className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setActiveMessageMenuId(activeMessageMenuId === m.id ? null : m.id)}
                              className="p-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors"
                              title="Options"
                            >
                              <MoreHorizontal className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Message actions dropdown */}
                          {activeMessageMenuId === m.id && (
                            <div className={`absolute top-full mt-1 ${isMe ? 'right-0' : 'left-0'} bg-white border border-slate-200 rounded-2xl shadow-xl py-1 w-32 z-30 animate-in fade-in duration-100`}>
                              <button
                                onClick={() => hideMessageLocally(m.id)}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                              >
                                Delete for Me
                              </button>
                              {isMe && (
                                <button
                                  onClick={() => handleDeleteMessageForEveryone(m.id)}
                                  className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 border-t border-slate-100"
                                >
                                  Delete for Everyone
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Reactions display under the bubble */}
                        {m.reactions && m.reactions.length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {Object.entries(
                              (m.reactions || []).reduce((acc: Record<string, string[]>, curr) => {
                                acc[curr.emoji] = acc[curr.emoji] || [];
                                acc[curr.emoji].push(curr.username);
                                return acc;
                              }, {})
                            ).map(([emoji, users]) => {
                              const hasReacted = users.includes(user.username);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => handleAddReaction(m.id, emoji)}
                                  title={users.map((u) => `@${u}`).join(', ')}
                                  className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-full border text-[9px] font-extrabold transition-all ${
                                    hasReacted
                                      ? 'bg-slate-900 border-slate-900 text-white font-extrabold'
                                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span>{users.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-black/[0.04] bg-white space-y-2 z-10">
              {replyToMessage && (
                <div className="flex items-center justify-between p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl animate-in slide-in-from-bottom-2 duration-100">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700 min-w-0">
                    <CornerUpLeft className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span>Replying to <span className="font-bold">@{replyToMessage.username}</span>:</span>
                    <span className="truncate italic font-normal text-slate-400">"{replyToMessage.message}"</span>
                  </div>
                  <button
                    onClick={() => setReplyToMessage(null)}
                    className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {uploadingAttachment && (
                <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-2xl animate-in slide-in-from-bottom-2 duration-100">
                  <div className="flex items-center space-x-2.5 text-xs font-bold text-slate-700 min-w-0">
                    {uploadingAttachment.file_type.startsWith('image/') ? (
                      <img
                        src={uploadingAttachment.url}
                        className="w-8 h-8 rounded-lg object-cover border border-slate-200/40"
                        alt={uploadingAttachment.name}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <HardDrive className="w-4 h-4" />
                      </div>
                    )}
                    <div className="text-left min-w-0">
                      <div className="truncate max-w-[150px]">{uploadingAttachment.name}</div>
                      <div className="text-[10px] text-slate-400 font-light">
                        {(uploadingAttachment.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setUploadingAttachment(null)}
                    className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-center space-x-2">
                <label className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors shrink-0">
                  <Paperclip className="w-4 h-4" />
                  <input
                    type="file"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>

                <input
                  type="text"
                  placeholder={`Message ${
                    selectedTeam?.name.startsWith('DM')
                      ? (() => {
                          let targetUname = '';
                          if (selectedTeam.name.startsWith('DM:')) {
                            const parts = selectedTeam.name.replace('DM:', '').split('-');
                            targetUname = parts.find((u) => u !== user.username) || user.username;
                          } else {
                            targetUname = selectedTeam.name.replace('DM with @', '').replace('DM @', '').trim();
                          }
                          return targetUname === user.username ? 'Note to Self' : `@${targetUname}`;
                        })()
                      : selectedTeam?.name || 'chat'
                  }...`}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  className="flex-1 px-4 py-3 text-xs font-semibold rounded-full bg-slate-50 border border-slate-200 focus:outline-none focus:border-slate-400 bg-slate-50/50"
                />

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActiveReactionSelectorId(activeReactionSelectorId === 'input' ? null : 'input')}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  {activeReactionSelectorId === 'input' && (
                    <div className="absolute bottom-full right-0 mb-2 bg-white border border-slate-200 rounded-full px-2 py-1 shadow-xl flex items-center space-x-1.5 z-30 animate-in fade-in zoom-in duration-100">
                      {[
                        '👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🚀', '✨'
                      ].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setInputMessage((prev) => prev + emoji);
                            setActiveReactionSelectorId(null);
                          }}
                          className="text-sm hover:scale-125 transition-transform p-0.5"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!inputMessage.trim() && !uploadingAttachment}
                  className="w-9 h-9 bg-slate-900 disabled:opacity-40 text-white rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors shrink-0 shadow-sm"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* Instagram-Style User Selection Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 w-full max-w-sm overflow-hidden flex flex-col max-h-[85vh]">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">New Conversation</h2>
              <button
                onClick={() => {
                  setSelectedUsers([]);
                  setShowModal(false);
                }}
                className="text-xs font-bold text-slate-400 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>

            {/* User Search Bar */}
            <div className="my-3">
              <input
                type="text"
                placeholder="Search co-workers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-3.5 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-600 bg-slate-50/50"
              />
            </div>

            {/* List of members with Multi-Select Checkboxes */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1 max-h-60">
              {filteredMembers.length > 0 ? (
                filteredMembers.map((m) => {
                  const isSelected = selectedUsers.includes(m.username);
                  const isSelf = m.username === user.username;
                  return (
                    <button
                      key={m.user_id}
                      type="button"
                      onClick={() => handleUserToggle(m.username)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-2xl border transition-all text-left ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50'
                          : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <UserAvatar seed={m.username} avatarUrl={m.avatar_url} size={32} />
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            {isSelf ? `@${m.username} (You)` : `@${m.username}`}
                          </div>
                          <div className="text-[10px] text-slate-400 capitalize">{m.role}</div>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                        isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-xs text-slate-400 py-6 text-center">No matching members found</div>
              )}
            </div>

            {/* If more than 1 user is selected, show Group Channel Settings */}
            {selectedUsers.length > 1 && (
              <div className="pt-4 border-t border-slate-100 mt-3 space-y-2 animate-in slide-in-from-bottom duration-200">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Group Channel Name</label>
                  <input
                    type="text"
                    placeholder="e.g. engineering-team"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-600 bg-slate-50/50"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Group Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Discuss tech & backend updates"
                    value={newTeamDesc}
                    onChange={(e) => setNewTeamDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-600 bg-slate-50/50"
                  />
                </div>
              </div>
            )}

            {/* Action Button */}
            <div className="pt-4 mt-2">
              <button
                type="button"
                onClick={handleCreateSubmit}
                disabled={selectedUsers.length === 0}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2"
              >
                {selectedUsers.length > 1 ? (
                  <>
                    <Users className="w-4 h-4" />
                    <span>Create Group Channel ({selectedUsers.length})</span>
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-4 h-4" />
                    <span>
                      {selectedUsers[0] === user.username
                        ? 'Open Note to Self'
                        : `Chat with ${selectedUsers[0] || 'Member'}`}
                    </span>
                  </>
                )}
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
