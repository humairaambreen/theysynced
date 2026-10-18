import React, { useState } from 'react';
import { Company, UserProfile } from '../types';
import { Building2, Plus, LogOut, ChevronDown, Copy, Check, Users, Sparkles, Search, Settings, Trash2 } from 'lucide-react';
import { UserAvatar } from './UserAvatar';

interface NavbarProps {
  user: UserProfile | null;
  companies: Company[];
  activeCompany: Company | null;
  onSelectCompany: (company: Company) => void;
  onOpenCreateCompany: () => void;
  onOpenJoinCompany: () => void;
  onOpenSettings: () => void;
  onOpenUserSettings: () => void;
  onOpenCommandPalette: () => void;
  onOpenInvite?: () => void;
  onLeaveCompany?: (company: Company) => void;
  onDeleteCompany?: (company: Company) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  companies,
  activeCompany,
  onSelectCompany,
  onOpenCreateCompany,
  onOpenJoinCompany,
  onOpenSettings,
  onOpenUserSettings,
  onOpenCommandPalette,
  onOpenInvite,
  onLeaveCompany,
  onDeleteCompany,
  onLogout,
}) => {
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const copyJoinCode = () => {
    if (activeCompany) {
      navigator.clipboard.writeText(activeCompany.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const isOwner = user && activeCompany && activeCompany.owner_id === user.id;
  const isAdmin = activeCompany && user && (
    activeCompany.owner_id === user.id ||
    activeCompany.members?.some(
      (m) => m.user_id === user.id && (m.role === 'Owner' || m.role === 'Admin')
    )
  );

  return (
    <header className="sticky top-0 z-40 bg-[#F8F9FB]/90 backdrop-blur-md border-b border-black/[0.04] px-6 h-16 shrink-0 flex items-center">
      <div className="w-full max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Brand & Workspace Selector */}
        <div className="flex items-center space-x-6 shrink-0">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl font-bold tracking-tight text-slate-900 font-sans">
              TheySynced
            </span>
          </div>

          {/* Company Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
              className="flex items-center space-x-2 px-4 py-2 bg-white rounded-full border border-black/[0.06] shadow-sm hover:border-black/15 transition-all text-sm font-medium text-slate-800"
            >
              {activeCompany?.logo_url ? (
                <img src={activeCompany.logo_url} className="w-4 h-4 rounded-md object-cover shrink-0" alt="" />
              ) : (
                <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
              )}
              <span className="font-bold truncate max-w-[140px]">{activeCompany ? activeCompany.name : 'Select Company'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {showCompanyDropdown && (
              <div className="absolute left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 mt-2 w-72 max-w-[95vw] bg-white rounded-3xl shadow-2xl border border-slate-200/90 p-3 z-50 animate-fade-in">
                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Your Companies</span>
                  <span className="text-[10px] text-slate-400 font-normal">{companies.length} active</span>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1 my-1">
                  {companies.map((c) => {
                    const cOwner = user && c.owner_id === user.id;
                    const isActive = activeCompany?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          onSelectCompany(c);
                          setShowCompanyDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all ${
                          isActive ? 'bg-indigo-50 text-indigo-900 font-bold border border-indigo-100' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          {c.logo_url ? (
                            <img src={c.logo_url} className="w-5 h-5 rounded-lg object-cover shrink-0" alt="" />
                          ) : (
                            <div className="w-5 h-5 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {c.name.charAt(0)}
                            </div>
                          )}
                          <span className="truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            cOwner ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {cOwner ? 'Owner' : 'Member'}
                          </span>
                          {isActive && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeCompany && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <div className="px-3 py-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Current: {activeCompany.name}
                    </div>

                    <button
                      onClick={() => {
                        onOpenSettings();
                        setShowCompanyDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                    >
                      <Settings className="w-3.5 h-3.5 text-slate-400" />
                      <span>Company Settings & Data</span>
                    </button>

                    {isOwner ? (
                      <button
                        onClick={() => {
                          onOpenSettings();
                          setShowCompanyDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center space-x-2"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        <span>Delete Company (Danger)</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (onLeaveCompany && activeCompany) {
                            onLeaveCompany(activeCompany);
                          } else {
                            onOpenSettings();
                          }
                          setShowCompanyDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold text-amber-700 hover:bg-amber-50 flex items-center space-x-2"
                      >
                        <LogOut className="w-3.5 h-3.5 text-amber-600" />
                        <span>Leave Company</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 space-y-1">
                  <button
                    onClick={() => {
                      onOpenCreateCompany();
                      setShowCompanyDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold text-indigo-600 hover:bg-indigo-50 flex items-center space-x-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Create New Company</span>
                  </button>
                  <button
                    onClick={() => {
                      onOpenJoinCompany();
                      setShowCompanyDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-2xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                  >
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>Join with Code or Invite Link</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Invite Members Button */}
          {activeCompany && isAdmin && (
            <button
              onClick={onOpenInvite}
              title="Manage and create invite links"
              className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 rounded-full text-xs font-semibold transition-colors shrink-0"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Invite Members</span>
            </button>
          )}

          {/* Company Settings Button - Accessible to all members and owner */}
          {activeCompany && (
            <button
              onClick={onOpenSettings}
              title="Company Governance, Settings & Data"
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition-all shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">{isOwner ? 'Company Admin' : 'Company Settings'}</span>
            </button>
          )}
        </div>


        {/* Right Actions & User Profile */}
        <div className="flex items-center space-x-3 shrink-0">
          {/* Desktop Search Button */}
          <button
            onClick={onOpenCommandPalette}
            className="hidden md:flex items-center space-x-2 px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded-full text-xs font-medium transition-all border border-slate-200 hover:border-slate-300 shadow-xs"
          >
            <Search className="w-3.5 h-3.5 stroke-[1.5]" />
            <span className="font-semibold text-slate-700">Search</span>
            <kbd className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded-md text-[10px] text-slate-400 font-mono shadow-2xs">Cmd K</kbd>
          </button>

          {/* Mobile Search Icon Button */}
          <button
            onClick={onOpenCommandPalette}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-full bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 transition-all shadow-xs"
            title="Search"
          >
            <Search className="w-4 h-4 stroke-[1.5]" />
          </button>

          {/* User Profile Badge (Click to open User Settings Modal) */}
          {user && (
            <div className="flex items-center space-x-2 pl-3 border-l border-slate-200">
              <button
                onClick={onOpenUserSettings}
                title="Open Profile & Security Settings"
                className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
              >
                <UserAvatar seed={user.username} avatarUrl={user.avatar_url} size={32} />
                <span className="hidden lg:inline text-xs font-semibold text-slate-800">
                  @{user.username}
                </span>
              </button>


            </div>
          )}
        </div>

      </div>
    </header>
  );
};
