import React, { useState } from 'react';
import { Company, UserProfile } from '../types';
import { Building2, Plus, LogOut, ChevronDown, Copy, Check, Users, Sparkles, Search } from 'lucide-react';
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
              <div className="absolute left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 mt-2 w-64 max-w-[90vw] bg-white rounded-3xl shadow-xl border border-slate-200/80 p-2 z-50 animate-fade-in">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Your Companies
                </div>
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onSelectCompany(c);
                      setShowCompanyDropdown(false);
                    }}
                    className={`w-full text-left px-3.5 py-2 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all ${
                      activeCompany?.id === c.id ? 'bg-indigo-50 text-indigo-900 font-bold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {activeCompany?.id === c.id && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                  </button>
                ))}

                <div className="pt-2 mt-2 border-t border-slate-100 space-y-1">
                  <button
                    onClick={() => {
                      onOpenCreateCompany();
                      setShowCompanyDropdown(false);
                    }}
                    className="w-full text-left px-3.5 py-2 rounded-2xl text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center space-x-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                    <span>Create New Company</span>
                  </button>
                  <button
                    onClick={() => {
                      onOpenJoinCompany();
                      setShowCompanyDropdown(false);
                    }}
                    className="w-full text-left px-3.5 py-2 rounded-2xl text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center space-x-2"
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


          {/* Company Admin Settings Button */}
          {isOwner && (
            <button
              onClick={onOpenSettings}
              title="Company Governance Settings"
              className="hidden md:flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition-all shrink-0"
            >
              <span>Company Admin</span>
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
