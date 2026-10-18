import React, { useState, useEffect, useRef } from 'react';
import { ActiveTab, ChatMessage, Company, Team, UserProfile, WorkspaceAsset } from './types';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { OfficeOverviewGrid } from './components/OfficeOverviewGrid';
import { ChatView } from './components/ChatView';
import { ExcalidrawBoard } from './components/ExcalidrawBoard';
import { SpreadsheetView } from './components/SpreadsheetView';
import { DocsView } from './components/DocsView';
import { SharedAssetsView } from './components/SharedAssetsView';
import { ActivityHubView } from './components/ActivityHubView';
import { AuthModal } from './components/AuthModal';
import { CompanyModal } from './components/CompanyModal';
import { CompanySettingsModal } from './components/CompanySettingsModal';
import { UserSettingsModal } from './components/UserSettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { LandingPage } from './components/LandingPage';
import { Building2, AlertTriangle } from 'lucide-react';
import { getAllOfflineAssets } from './lib/offlineStore';
import { InviteModal } from './components/InviteModal';
import { RdpView } from './components/RdpView';
import { SharedTerminalView } from './components/SharedTerminalView';
import { TasksKanbanView } from './components/TasksKanbanView';
import { BrowserView } from './components/BrowserView';







export default function App() {

  const [token, setToken] = useState<string | null>(typeof window !== 'undefined' ? localStorage.getItem('theysynced_token') : null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);

  const [companyModalMode, setCompanyModalMode] = useState<'create' | 'join' | null>(null);
  const [showCompanySettings, setShowCompanySettings] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);


  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | undefined>(undefined);
  const [terminalInitialPath, setTerminalInitialPath] = useState<string>('/workspace');
  const [browserInitialUrl, setBrowserInitialUrl] = useState<string>('http://localhost:3000');

  const [screenSeconds, setScreenSeconds] = useState(0);
  const currentChannelIdRef = useRef<string | undefined>(undefined);

  // Synchronize browser URL with current workspace state without reload
  const syncUrl = (tab: ActiveTab, teamId?: string, currentTeams?: Team[]) => {
    if (typeof window === 'undefined') return;
    let path = '/';
    const list = currentTeams || teams;

    if (tab === 'overview') {
      path = '/';
    } else if (tab === 'teams') {
      const activeId = teamId || activeTeamId;
      const targetTeam = list.find((t) => t.id === activeId);
      if (targetTeam) {
        if (targetTeam.name.startsWith('DM:')) {
          const cleanDm = targetTeam.name.replace('DM:', 'dm-').toLowerCase();
          path = `/chat/${encodeURIComponent(cleanDm)}`;
        } else {
          path = `/chat/${encodeURIComponent(targetTeam.name.toLowerCase())}`;
        }
      } else {
        path = '/chat/general';
      }
    } else if (tab === 'tasks') {
      path = '/tasks';
    } else if (tab === 'browser') {
      path = '/browser';
    } else if (tab === 'assets') {
      path = '/assets';
    } else if (tab === 'terminal') {
      path = '/terminal';
    } else if (tab === 'whiteboard') {
      path = '/whiteboard';
    } else if (tab === 'spreadsheet') {
      path = '/spreadsheet';
    } else if (tab === 'docs') {
      path = '/docs';
    } else if (tab === 'rdp') {
      path = '/rdp';
    } else if (tab === 'activity') {
      path = '/activity';
    }

    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  // Central tab navigation handler supporting deep subitem selection
  const handleNavigateTab = (tab: ActiveTab, subItem?: string) => {
    if (tab === 'teams') {
      if (subItem) setActiveTeamId(subItem);
      setActiveTab('teams');
      syncUrl('teams', subItem);
    } else if (tab === 'terminal') {
      if (subItem) setTerminalInitialPath(subItem);
      setActiveTab('terminal');
      syncUrl('terminal');
    } else if (tab === 'tasks') {
      setActiveTab('tasks');
      syncUrl('tasks');
    } else if (tab === 'browser') {
      if (subItem) setBrowserInitialUrl(subItem);
      setActiveTab('browser');
      syncUrl('browser');
    } else if (tab === 'assets') {
      setActiveTab('assets');
      syncUrl('assets');
    } else if (tab === 'spreadsheet') {
      setActiveTab('spreadsheet');
      syncUrl('spreadsheet');
    } else if (tab === 'whiteboard') {
      setActiveTab('whiteboard');
      syncUrl('whiteboard');
    } else if (tab === 'docs') {
      setActiveTab('docs');
      syncUrl('docs');
    } else {
      setActiveTab(tab);
      syncUrl(tab);
    }
  };

  // Parse path on initial load or browser back/forward (popstate)
  const handleRouteFromPath = (path: string, currentTeams: Team[]) => {
    const clean = path.replace(/^\/+/, '').split('/');
    const section = clean[0]?.toLowerCase() || '';
    const param = clean[1] ? decodeURIComponent(clean[1]).toLowerCase() : '';

    if (section === 'chat') {
      setActiveTab('teams');
      if (param && currentTeams.length > 0) {
        const found = currentTeams.find((t) => {
          if (t.id.toLowerCase() === param) return true;
          if (t.name.toLowerCase() === param) return true;
          if (t.name.toLowerCase() === `dm:${param.replace(/^dm-/, '')}`) return true;
          return false;
        });
        if (found) {
          setActiveTeamId(found.id);
        }
      }
    } else if (section === 'tasks' || section === 'jira' || section === 'kanban') {
      setActiveTab('tasks');
    } else if (section === 'browser' || section === 'web') {
      setActiveTab('browser');
    } else if (section === 'assets' || section === 'storage' || section === 'files') {
      setActiveTab('assets');
    } else if (section === 'terminal' || section === 'linux' || section === 'shell') {
      setActiveTab('terminal');
    } else if (section === 'whiteboard' || section === 'excalidraw') {
      setActiveTab('whiteboard');
    } else if (section === 'spreadsheet' || section === 'sheets') {
      setActiveTab('spreadsheet');
    } else if (section === 'docs') {
      setActiveTab('docs');
    } else if (section === 'rdp') {
      setActiveTab('rdp');
    } else if (section === 'activity') {
      setActiveTab('activity');
    } else if (section === 'overview' || !section) {
      setActiveTab('overview');
    }
  };

  // Popstate event listener for browser Back/Forward navigation
  useEffect(() => {
    const onPopState = () => {
      handleRouteFromPath(window.location.pathname, teams);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [teams]);

  // Initial URL check once teams are loaded or on mount
  const hasInitializedRouteRef = useRef(false);
  useEffect(() => {
    if (teams.length > 0 && !hasInitializedRouteRef.current) {
      hasInitializedRouteRef.current = true;
      handleRouteFromPath(window.location.pathname, teams);
    }
  }, [teams]);

  useEffect(() => {
    currentChannelIdRef.current = activeTeamId || activeCompany?.id;
  }, [activeTeamId, activeCompany?.id]);

  // Initialize screenSeconds from logged-in user profile, and track active time
  useEffect(() => {
    if (user?.total_active_seconds !== undefined) {
      setScreenSeconds(user.total_active_seconds);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user || !token) return;

    // Track active seconds every second
    const secondsInterval = setInterval(() => {
      if (document.hasFocus()) {
        setScreenSeconds((prev) => prev + 1);
      }
    }, 1000);

    return () => clearInterval(secondsInterval);
  }, [user?.id, token]);

  // Pulse/Sync active screen time to the database every 10 seconds
  useEffect(() => {
    if (!user || !token) return;

    const pulseInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/users/active-pulse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, active_seconds: screenSeconds }),
        });
        const data = await response.json();
        if (data.success && data.user) {
          setUser(data.user);
        }
      } catch (err) {
        // ignore
      }
    }, 10000);

    return () => clearInterval(pulseInterval);
  }, [user?.id, token, screenSeconds]);

  // Fetch chat messages when active channel/team changes
  useEffect(() => {
    if (!token) return;
    const channelId = activeTeamId || activeCompany?.id;
    if (!channelId) return;

    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/chat/messages?token=${encodeURIComponent(token)}&channel_id=${encodeURIComponent(channelId)}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.messages)) {
          setChatMessages(data.messages);
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    };

    fetchMessages();
  }, [activeTeamId, activeCompany?.id, token]);

  const fetchAssets = async (authToken: string, companyId: string) => {
    try {
      const offline = await getAllOfflineAssets(companyId);
      const res = await fetch(`/api/assets/list?token=${authToken}&company_id=${companyId}`);
      const data = await res.json();
      
      let unified: WorkspaceAsset[] = [];
      offline.forEach((off) => {
        unified.push({
          id: off.id,
          company_id: off.company_id,
          team_id: undefined,
          asset_type: off.asset_type === 'document' ? 'doc' : off.asset_type === 'excalidraw' ? 'whiteboard' : off.asset_type,
          name: off.title,
          content: off.content,
          created_by: 'Me',
          updated_at: off.updated_at,
        });
      });

      if (data.success && Array.isArray(data.assets)) {
        data.assets.forEach((online: any) => {
          const normType = online.asset_type === 'document' ? 'doc' : online.asset_type === 'excalidraw' ? 'whiteboard' : online.asset_type;
          const idx = unified.findIndex((a) => a.id === online.id);
          if (idx !== -1) {
            const offlineTime = new Date(unified[idx].updated_at || 0).getTime();
            const onlineTime = new Date(online.updated_at || 0).getTime();
            if (onlineTime > offlineTime) {
              unified[idx] = {
                id: online.id,
                company_id: online.company_id,
                team_id: online.team_id || undefined,
                asset_type: normType,
                name: online.name,
                content: online.content,
                created_by: online.created_by,
                updated_at: online.updated_at,
              };
            }
          } else {
            unified.push({
              id: online.id,
              company_id: online.company_id,
              team_id: online.team_id || undefined,
              asset_type: normType,
              name: online.name,
              content: online.content,
              created_by: online.created_by,
              updated_at: online.updated_at,
            });
          }
        });
      }
      setAssets(unified);
    } catch (e) {
      try {
        const offline = await getAllOfflineAssets(companyId);
        setAssets(offline.map(off => ({
          id: off.id,
          company_id: off.company_id,
          team_id: undefined,
          asset_type: off.asset_type === 'document' ? 'doc' : off.asset_type === 'excalidraw' ? 'whiteboard' : off.asset_type,
          name: off.title,
          content: off.content,
          created_by: 'Me',
          updated_at: off.updated_at,
        })));
      } catch (err) {
        // ignore
      }
    }
  };







  // Authenticate user on load if token exists
  useEffect(() => {
    if (!token) return;

    fetch(`/api/auth/me?token=${token}`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user) {
          setUser(data.user);
          fetchUserCompanies(token);
        } else {
          setToken(null);
          localStorage.removeItem('theysynced_token');
        }
      })
      .catch(() => {
        setToken(null);
        localStorage.removeItem('theysynced_token');
      });
  }, [token]);

  // Handle invite links in the URL path (e.g. /invite/invite_a8Fj2k9)
  useEffect(() => {
    const handleUrlInvite = async () => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname;
      if (path.includes('/invite/')) {
        const inviteCode = path.split('/invite/')[1];
        if (inviteCode && inviteCode.startsWith('invite_')) {
          if (token) {
            try {
              const res = await fetch('/api/invites/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, code: inviteCode }),
              });
              const data = await res.json();
              if (data.success && data.company) {
                // Successfully joined! Re-fetch companies
                await fetchUserCompanies(token);
                // Switch to this company
                setActiveCompany(data.company);
                // Clear query path
                window.history.replaceState({}, document.title, '/');
              } else {
                alert(data.error || 'Failed to join via invite link');
                window.history.replaceState({}, document.title, '/');
              }
            } catch (err) {
              // ignore
            }
          } else {
            // Save invite code and open login/auth modal
            localStorage.setItem('pending_invite_code', inviteCode);
            setShowAuthModal(true);
          }
        }
      }
    };
    handleUrlInvite();
  }, [token]);

  // Check for pending invite code after successful authentication
  useEffect(() => {
    if (token && user) {
      const pendingInvite = localStorage.getItem('pending_invite_code');
      if (pendingInvite) {
        localStorage.removeItem('pending_invite_code');
        fetch('/api/invites/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, code: pendingInvite }),
        })
          .then((res) => res.json())
          .then(async (data) => {
            if (data.success && data.company) {
              await fetchUserCompanies(token);
              setActiveCompany(data.company);
            } else {
              alert(data.error || 'Failed to join workspace via invite link');
            }
          })
          .catch(() => {});
      }
    }
  }, [token, user]);


  const fetchUserCompanies = async (authToken: string) => {
    try {
      const res = await fetch(`/api/companies/list?token=${authToken}`);
      const data = await res.json();
      if (data.success && data.companies && data.companies.length > 0) {
        setCompanies(data.companies);
        const storedCompId = typeof window !== 'undefined' ? localStorage.getItem('theysynced_active_company_id') : null;
        const matched = data.companies.find((c: Company) => c.id === storedCompId);
        const selected = matched || data.companies[0];
        setActiveCompany(selected);
        if (typeof window !== 'undefined') {
          localStorage.setItem('theysynced_active_company_id', selected.id);
        }
        fetchTeams(authToken, selected.id);
        fetchAssets(authToken, selected.id);
      } else {
        setCompanies([]);
        setActiveCompany(null);
      }
    } catch (e) {
      setCompanies([]);
      setActiveCompany(null);
    } finally {
      setIsLoadingCompanies(false);
    }
  };



  const fetchTeams = async (authToken: string, companyId: string) => {
    try {
      const res = await fetch(`/api/teams/list?token=${authToken}&company_id=${companyId}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.teams) && data.teams.length > 0) {
        setTeams(data.teams);
        setActiveTeamId((prev) => {
          if (prev && data.teams.some((t: any) => t.id === prev)) return prev;
          const genTeam = data.teams.find((t: any) => t.name.toLowerCase() === 'general') || data.teams[0];
          return genTeam ? genTeam.id : undefined;
        });
      } else {
        const defaultGen = `team_${companyId}_gen`;
        setTeams([
          {
            id: defaultGen,
            company_id: companyId,
            name: 'General',
            description: 'Company-wide discussions',
            created_at: new Date().toISOString(),
          },
          {
            id: `team_${companyId}_proj`,
            company_id: companyId,
            name: 'Projects',
            description: 'Whiteboards & statistics',
            created_at: new Date().toISOString(),
          },
        ]);
        setActiveTeamId((prev) => prev || defaultGen);
      }
    } catch (e) {
      // fallback
    }
  };

  // Detect if user is kicked or banned from the active company
  useEffect(() => {
    if (activeCompany && user) {
      const isStillMember = activeCompany.members?.some((m) => m.user_id === user.id) || activeCompany.owner_id === user.id;
      if (!isStillMember) {
        setActiveCompany(null);
        if (token) {
          fetchUserCompanies(token);
        }
      }
    }
  }, [activeCompany, user, token]);

  // Connect to Axum WebSocket Hub for real-time sync

  useEffect(() => {
    if (!activeCompany || !user) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${activeCompany.id}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          user_id: user.id,
          username: user.username,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init' && data.state?.chat_messages) {
          const currentChannelId = currentChannelIdRef.current;
          if (currentChannelId) {
            const isGen = currentChannelId.startsWith('team_') && currentChannelId.endsWith('_gen');
            const relevant = data.state.chat_messages.filter(
              (m: ChatMessage) => {
                const msgCh = m.team_id || m.company_id;
                return msgCh === currentChannelId || (isGen && (msgCh === activeCompany?.id || !m.team_id));
              }
            );
            if (relevant.length > 0) {
              setChatMessages((prev) => {
                const map = new Map(prev.map((m) => [m.id, m]));
                relevant.forEach((m: ChatMessage) => map.set(m.id, m));
                return Array.from(map.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
              });
            }
          }
        } else if (data.type === 'chat' && data.data) {
          const msg = data.data;
          const currentChannelId = currentChannelIdRef.current;
          const msgChannelId = msg.team_id || msg.company_id;
          const isGen = currentChannelId?.startsWith('team_') && currentChannelId?.endsWith('_gen');
          const isMatch = msgChannelId === currentChannelId || (isGen && (msgChannelId === activeCompany?.id || !msg.team_id));
          if (isMatch) {
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
        } else if (data.type === 'reaction_update') {
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id ? { ...m, reactions: data.reactions } : m
            )
          );
        } else if (data.type === 'message_deleted') {
          setChatMessages((prev) => prev.filter((m) => m.id !== data.message_id));
        } else if (data.type === 'workspace_purged') {
          if (data.company_id === activeCompany?.id) {
            alert('This workspace has been permanently purged due to inactivity or owner deletion.');
            if (token) fetchUserCompanies(token);
          }
        }
      } catch (err) {
        // ignore
      }
    };

    setWebsocket(ws);

    return () => {
      ws.close();
    };
  }, [activeCompany?.id, user?.id]);

  const handleSelectCompany = (comp: Company) => {
    setActiveCompany(comp);
    if (typeof window !== 'undefined') {
      localStorage.setItem('theysynced_active_company_id', comp.id);
    }
    setChatMessages([]);
    if (token) {
      fetchTeams(token, comp.id);
      fetchAssets(token, comp.id);
    }
  };

  const handleCompanyCreatedOrJoined = (comp: Company) => {
    setCompanies((prev) => {
      const exists = prev.some((c) => c.id === comp.id);
      if (exists) {
        return prev.map((c) => (c.id === comp.id ? comp : c));
      }
      return [...prev, comp];
    });
    setActiveCompany(comp);
    if (typeof window !== 'undefined') {
      localStorage.setItem('theysynced_active_company_id', comp.id);
    }
    setChatMessages([]);
    if (token) {
      fetchTeams(token, comp.id);
      fetchAssets(token, comp.id);
    }
  };

  const handleCompanyDeleted = (deletedCompanyId?: string) => {
    const targetId = deletedCompanyId || activeCompany?.id;
    const remaining = companies.filter((c) => c.id !== targetId);
    setCompanies(remaining);
    const nextCompany = remaining[0] || null;
    setActiveCompany(nextCompany);
    if (nextCompany) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('theysynced_active_company_id', nextCompany.id);
      }
      setChatMessages([]);
      if (token) {
        fetchTeams(token, nextCompany.id);
        fetchAssets(token, nextCompany.id);
      }
    } else {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('theysynced_active_company_id');
      }
      setTeams([]);
      setAssets([]);
      setChatMessages([]);
    }
    setShowCompanySettings(false);
  };

  const handleLeaveCompany = async (targetCompany?: Company) => {
    const compToLeave = targetCompany || activeCompany;
    if (!compToLeave || !token) return;

    if (!window.confirm(`Are you sure you want to leave ${compToLeave.name}?`)) {
      return;
    }

    try {
      const res = await fetch('/api/companies/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: compToLeave.id }),
      });
      const data = await res.json();
      if (data.success) {
        handleCompanyDeleted(compToLeave.id);
      } else {
        alert(data.message || data.error || 'Failed to leave company');
      }
    } catch (err: any) {
      alert(err.message || 'Network error');
    }
  };



  const handleSendMessage = async (text: string, teamId?: string, attachment?: any) => {
    if (!user || !activeCompany) return;
    const targetTeamId = teamId || activeTeamId || `team_${activeCompany.id}_gen`;

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          type: 'chat',
          message: text,
          team_id: targetTeamId,
          user_id: user.id,
          username: user.username,
          file_attachment: attachment,
        })
      );
    } else if (token) {
      // Fallback to HTTP save endpoint so chat is never dropped
      try {
        const res = await fetch('/api/chat/messages/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            channel_id: targetTeamId,
            company_id: activeCompany.id,
            user_id: user.id,
            username: user.username,
            message: text,
            file_attachment: attachment,
          }),
        });
        const data = await res.json();
        if (data.success && data.message) {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
          if (attachment) {
            fetchAssets(token, activeCompany.id);
          }
        }
      } catch (err) {
        console.error("Failed to save chat message via HTTP fallback:", err);
      }
    }
  };

  const handleCreateTeam = async (name: string, description: string) => {
    if (!token || !activeCompany) return;
    try {
      const res = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: activeCompany.id, name, description }),
      });
      const data = await res.json();
      if (data.success && data.team) {
        setTeams((prev) => [...prev, data.team]);
        setActiveTeamId(data.team.id);
        syncUrl('teams', data.team.id);
      }
    } catch (e) {
      // fallback local
      const newT: Team = {
        id: `team_${Date.now()}`,
        company_id: activeCompany.id,
        name,
        description,
        created_at: new Date().toISOString(),
      };
      setTeams((prev) => [...prev, newT]);
      setActiveTeamId(newT.id);
      syncUrl('teams', newT.id);
    }
  };


  const handleDeleteTeam = async (teamId: string) => {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    if (!token || !activeCompany) return;
    try {
      await fetch('/api/teams/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: activeCompany.id, team_id: teamId }),
      });
    } catch (e) {
      // ignore
    }
  };


  const handleSaveAsset = async (nameOrAsset: string | Partial<WorkspaceAsset>, content?: string, scope?: 'shared' | 'private') => {
    if (!token || !activeCompany || !user) return;
    
    let assetToSave: WorkspaceAsset;
    if (typeof nameOrAsset === 'object') {
      assetToSave = {
        id: nameOrAsset.id || `asset_${Date.now()}`,
        company_id: activeCompany.id,
        asset_type: nameOrAsset.asset_type || 'file',
        name: nameOrAsset.name || 'Untitled',
        content: nameOrAsset.content || '',
        created_by: nameOrAsset.created_by || user.username,
        updated_at: new Date().toISOString(),
        folder_id: nameOrAsset.folder_id,
        folder_path: nameOrAsset.folder_path,
        parent_id: nameOrAsset.parent_id,
        file_type: nameOrAsset.file_type,
        size: nameOrAsset.size,
        url: nameOrAsset.url,
        scope: nameOrAsset.scope || 'shared',
        allowed_users: nameOrAsset.allowed_users,
      };
    } else {
      const assetType = activeTab === 'whiteboard' ? 'whiteboard' : activeTab === 'spreadsheet' ? 'spreadsheet' : 'doc';
      const assetId = scope === 'private' 
        ? `${assetType}_${activeCompany.id}_user_${user.id}` 
        : `${assetType}_${activeCompany.id}`;

      assetToSave = {
        id: assetId,
        company_id: activeCompany.id,
        asset_type: assetType,
        name: nameOrAsset,
        content: content || '',
        created_by: user.username,
        updated_at: new Date().toISOString(),
        scope: scope || 'shared',
      };
    }

    setAssets((prev) => [...prev.filter((a) => a.id !== assetToSave.id), assetToSave]);

    try {
      await fetch('/api/assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: activeCompany.id, asset: assetToSave }),
      });
    } catch (e) {
      // ignore
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!token || !activeCompany) return;
    setAssets((prev) => prev.filter((a) => a.id !== assetId && a.parent_id !== assetId && a.folder_id !== assetId));
    try {
      await fetch('/api/assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: activeCompany.id, id: assetId }),
      });
    } catch (e) {
      // ignore
    }
  };


  const handleCommandPaletteNavigate = (tab: string, teamId?: string, memberUsername?: string) => {
    setActiveTab(tab as ActiveTab);
    if (tab === 'teams') {
      if (teamId) {
        setActiveTeamId(teamId);
        syncUrl('teams', teamId);
      } else if (memberUsername && user) {
        const sorted = [user.username, memberUsername].sort();
        const dmTeamName = `DM:${sorted[0]}-${sorted[1]}`;
        const existing = teams.find((t) => t.name === dmTeamName);
        if (existing) {
          setActiveTeamId(existing.id);
          syncUrl('teams', existing.id);
        } else {
          const desc = memberUsername === user.username
            ? 'Personal notebook & saved messages'
            : `Direct 1-on-1 messaging between @${sorted[0]} and @${sorted[1]}`;
          handleCreateTeam(dmTeamName, desc);
        }
      } else {
        syncUrl('teams');
      }
    } else {
      syncUrl(tab as ActiveTab);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('theysynced_token');
    setToken(null);
    setUser(null);
    setCompanies([]);
    setActiveCompany(null);
    setIsLoadingCompanies(true);
  };

  // Check URL parameters for landing page / auth overrides


  const [showAuthModal, setShowAuthModal] = useState(false);

  // If user is not authenticated, show the public Landing Page
  if (!token || !user) {
    return (
      <>
        <LandingPage
          onOpenAuth={() => setShowAuthModal(true)}
          onOpenCreateCompany={() => setShowAuthModal(true)}
          onOpenJoinCompany={() => setShowAuthModal(true)}
        />

        {showAuthModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <AuthModal
              onLoginSuccess={(authToken, userProfile) => {
                setToken(authToken);
                setUser(userProfile);
                setShowAuthModal(false);
                fetchUserCompanies(authToken);
              }}
              onClose={() => setShowAuthModal(false)}
            />
          </div>
        )}
      </>
    );
  }

  // If authenticated user is loading workspace, show loader
  if (user && isLoadingCompanies) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="text-slate-400 font-light text-sm animate-pulse">
          Loading workspace...
        </div>
      </div>
    );
  }

  // If authenticated user belongs to 0 companies, prompt them to Create or Join a company
  if (user && !isLoadingCompanies && companies.length === 0 && !activeCompany) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="bg-white rounded-3xl p-10 border border-slate-200/80 shadow-2xl max-w-lg w-full">
          <div className="w-16 h-16 rounded-3xl bg-[#E0E3FF] text-[#181A2A] flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-extrabold text-slate-950">Welcome, @{user.username}!</h2>
          <p className="text-slate-600 mt-2 text-sm">You are not part of any company yet. Create a new company or enter an invite code to join one.</p>

          <div className="mt-8 space-y-3">
            <button
              onClick={() => setCompanyModalMode('create')}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-slate-800 transition-all shadow-md"
            >
              Create a New Company
            </button>

            <button
              onClick={() => setCompanyModalMode('join')}
              className="w-full py-4 bg-slate-100 text-slate-800 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-all border border-slate-200"
            >
              Join with Invite Code
            </button>
          </div>

          <button
            onClick={handleLogout}
            className="mt-6 text-xs text-slate-400 hover:text-rose-600 font-semibold transition-colors"
          >
            Sign Out
          </button>
        </div>

        {companyModalMode && (
          <CompanyModal
            mode={companyModalMode}
            token={token}
            onClose={() => setCompanyModalMode(null)}
            onCompanyCreatedOrJoined={handleCompanyCreatedOrJoined}
          />
        )}
      </div>
    );
  }


  // Guests have read-only access to tools (Excalidraw, Spreadsheet, Docs)
  // but full access to chat
  const isViewer = user && activeCompany
    ? (activeCompany.members || []).some(
        (m) => m.user_id === user.id && m.role === 'Guest'
      )
    : false;

  const companyActiveDate = activeCompany?.last_activity_at
    ? new Date(activeCompany.last_activity_at)
    : activeCompany?.created_at
    ? new Date(activeCompany.created_at)
    : null;
  const daysInactive = companyActiveDate
    ? Math.max(0, Math.floor((Date.now() - companyActiveDate.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const daysUntilPurge = Math.max(0, 90 - daysInactive);
  const showInactivityWarning = !!(activeCompany && daysInactive >= 60);

  const handleKeepWorkspaceActive = async () => {
    if (!token || !activeCompany) return;
    try {
      await fetch('/api/companies/touch-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: activeCompany.id }),
      });
      const updated = { ...activeCompany, last_activity_at: new Date().toISOString() };
      setActiveCompany(updated);
      setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (_) {}
  };

  return (
    <div className="h-screen bg-[#F8F9FB] flex flex-col font-sans overflow-hidden">
      
      {/* Apple-style Top Navbar */}
      <Navbar
        user={user}
        companies={companies}
        activeCompany={activeCompany}
        onSelectCompany={handleSelectCompany}
        onOpenCreateCompany={() => setCompanyModalMode('create')}
        onOpenJoinCompany={() => setCompanyModalMode('join')}
        onOpenSettings={() => setShowCompanySettings(true)}
        onOpenUserSettings={() => setShowUserSettings(true)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onOpenInvite={() => setShowInviteModal(true)}
        onLeaveCompany={handleLeaveCompany}
        onDeleteCompany={() => setShowCompanySettings(true)}
        onLogout={handleLogout}
      />





      {/* Command Palette Modal (Cmd + K) */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        company={activeCompany}
        teams={teams}
        assets={assets}
        chatMessages={chatMessages}
        onNavigate={handleCommandPaletteNavigate}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Navigation Sidebar */}
        <Sidebar activeTab={activeTab} onTabChange={(t) => { setActiveTab(t); syncUrl(t); }} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {showInactivityWarning && (
            <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-bold flex items-center justify-between border-b border-amber-600 shadow-sm shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-slate-950 shrink-0" />
                <span>
                  Retention Warning: <strong>{activeCompany?.name}</strong> has been inactive for {daysInactive} days and will be automatically & permanently purged in {daysUntilPurge} days.
                </span>
              </div>
              <button
                onClick={handleKeepWorkspaceActive}
                className="ml-3 px-3 py-1 bg-slate-900 text-white rounded-full text-[11px] font-extrabold hover:bg-slate-800 transition-all shrink-0"
              >
                Keep Active
              </button>
            </div>
          )}

          {/* Dynamic Tab Views */}
          <main className={`flex-1 flex flex-col overflow-hidden pb-24 lg:pb-0 ${activeTab === 'overview' ? 'overflow-y-auto' : ''}`}>
          {activeTab === 'overview' && (
            <OfficeOverviewGrid company={activeCompany} onNavigateTab={(t) => { setActiveTab(t); syncUrl(t); }} />
          )}

          {activeTab === 'teams' && activeCompany && (
            <ChatView
              user={user}
              company={activeCompany}
              teams={teams}
              messages={chatMessages}
              onSendMessage={handleSendMessage}
              onCreateTeam={handleCreateTeam}
              onDeleteTeam={handleDeleteTeam}
              selectedTeamId={activeTeamId}
              onSelectTeam={(teamId) => { setActiveTeamId(teamId); syncUrl('teams', teamId); }}
              websocket={websocket}
            />
          )}

          {activeTab === 'assets' && activeCompany && user && (
            <SharedAssetsView
              user={user}
              company={activeCompany}
              teams={teams}
              chatMessages={chatMessages}
              assets={assets}
              onSaveAsset={handleSaveAsset}
              onDeleteAsset={handleDeleteAsset}
              onRefreshAssets={() => token && fetchAssets(token, activeCompany.id)}
              onNavigateTab={handleNavigateTab}
            />
          )}

          {activeTab === 'terminal' && activeCompany && user && (
            <SharedTerminalView
              user={user}
              company={activeCompany}
              teams={teams}
              chatMessages={chatMessages}
              assets={assets}
              websocket={websocket}
              onSaveAsset={handleSaveAsset}
              onDeleteAsset={handleDeleteAsset}
              onNavigateTab={handleNavigateTab}
              initialPath={terminalInitialPath}
            />
          )}

          {activeTab === 'tasks' && activeCompany && user && (
            <TasksKanbanView
              user={user}
              company={activeCompany}
              assets={assets}
              websocket={websocket}
              onSaveAsset={handleSaveAsset}
              onDeleteAsset={handleDeleteAsset}
              onNavigateTab={handleNavigateTab}
            />
          )}

          {activeTab === 'browser' && activeCompany && user && (
            <BrowserView
              user={user}
              company={activeCompany}
              initialUrl={browserInitialUrl}
              onNavigateTab={handleNavigateTab}
            />
          )}

          {activeTab === 'whiteboard' && activeCompany && (
            <ExcalidrawBoard
              user={user}
              company={activeCompany}
              websocket={websocket}
              onSaveAsset={handleSaveAsset}
              isViewer={isViewer}
            />
          )}

          {activeTab === 'spreadsheet' && activeCompany && (
            <SpreadsheetView
              user={user}
              company={activeCompany}
              websocket={websocket}
              onSaveAsset={handleSaveAsset}
              assets={assets}
              isViewer={isViewer}
            />
          )}

          {activeTab === 'docs' && activeCompany && (
            <DocsView
              user={user}
              company={activeCompany}
              websocket={websocket}
              onSaveAsset={handleSaveAsset}
              assets={assets}
              isViewer={isViewer}
            />
          )}

          {activeTab === 'activity' && activeCompany && token && (
            <ActivityHubView
              user={user}
              company={activeCompany}
              token={token}
              onCompanyUpdated={(updatedCompany) => {
                setActiveCompany(updatedCompany);
                setCompanies((prev) => prev.map((c) => (c.id === updatedCompany.id ? updatedCompany : c)));
              }}
            />
          )}

          {activeTab === 'rdp' && (
            <RdpView user={user} company={activeCompany} />
          )}

        </main>
        </div>

      </div>

      {/* Create / Join Company Modal */}
      {companyModalMode && (
        <CompanyModal
          mode={companyModalMode}
          token={token}
          onClose={() => setCompanyModalMode(null)}
          onCompanyCreatedOrJoined={handleCompanyCreatedOrJoined}
        />
      )}

      {/* Company Settings & Governance Modal */}
      {showCompanySettings && activeCompany && user && token && (
        <CompanySettingsModal
          user={user}
          company={activeCompany}
          token={token}
          onClose={() => setShowCompanySettings(false)}
          onCompanyUpdated={(updatedCompany) => {
            setActiveCompany(updatedCompany);
            setCompanies((prev) => prev.map((c) => (c.id === updatedCompany.id ? updatedCompany : c)));
          }}
          onCompanyDeleted={handleCompanyDeleted}
          onCompanyLeft={handleCompanyDeleted}
        />

      )}

      {/* User Profile & Passkey Settings Modal */}

      {showUserSettings && user && (
        <UserSettingsModal
          isOpen={showUserSettings}
          onClose={() => setShowUserSettings(false)}
          user={user}
          onLogout={handleLogout}
          onUpdateUser={(updated) => {
            setUser(updated);
            if (activeCompany) {
              const updatedMembers = (activeCompany.members || []).map((m) =>
                m.user_id === updated.id
                  ? { ...m, username: updated.username, avatar_url: updated.avatar_url }
                  : m
              );
              const updatedComp = { ...activeCompany, members: updatedMembers };
              setActiveCompany(updatedComp);
              setCompanies((prev) => prev.map((c) => c.id === activeCompany.id ? updatedComp : c));
            }
            setShowUserSettings(false);
          }}
        />
      )}

      {/* Discord-like Invite Management Modal */}
      {showInviteModal && activeCompany && token && (
        <InviteModal
          company={activeCompany}
          token={token}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
};




