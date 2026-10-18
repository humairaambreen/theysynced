import React, { useState } from 'react';
import { Company, UserProfile } from '../types';
import {
  Settings,
  Image,
  Trash2,
  Lock,
  Copy,
  Check,
  X,
  ShieldAlert,
  Download,
  Clock,
  ShieldCheck,
  Database,
  RefreshCw,
  AlertTriangle,
  Users,
  LogOut,
} from 'lucide-react';

interface CompanySettingsModalProps {
  user: UserProfile;
  company: Company;
  token: string;
  onClose: () => void;
  onCompanyUpdated: (updatedCompany: Company) => void;
  onCompanyDeleted: (deletedCompanyId?: string) => void;
  onCompanyLeft?: (companyId: string) => void;
}

export const CompanySettingsModal: React.FC<CompanySettingsModalProps> = ({
  user,
  company,
  token,
  onClose,
  onCompanyUpdated,
  onCompanyDeleted,
  onCompanyLeft,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'governance' | 'members' | 'danger' | 'leave'>('general');
  const [name, setName] = useState(company.name);
  const [logoUrl, setLogoUrl] = useState(company.logo_url || '');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [touching, setTouching] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);


  const isOwner = company.owner_id === user.id;
  const userMember = (company.members || []).find((m) => m.user_id === user.id);
  const isAdminOrOwner = isOwner || userMember?.role === 'Admin';

  // Inactivity metrics calculation (90 days = 3 months auto-purge policy)
  const lastActiveTimestamp = company.last_activity_at || company.created_at;
  const lastActiveDate = new Date(lastActiveTimestamp);
  const now = new Date();
  const daysSinceActive = Math.max(0, Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, 90 - daysSinceActive);
  const isCloseToPurge = daysRemaining <= 30;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 3 * 1024 * 1024) {
        setErrorMsg('Logo file size must be under 3MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/companies/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id, new_name: name.trim() }),
      });
      const data = await res.json();
      if (data.success && data.company) {
        onCompanyUpdated(data.company);
        setSuccessMsg('Company renamed successfully!');
      } else {
        setErrorMsg(data.message || 'Failed to rename company');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLogo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/companies/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id, logo_url: logoUrl }),
      });
      const data = await res.json();
      if (data.success && data.company) {
        onCompanyUpdated(data.company);
        setSuccessMsg('Company logo updated!');
      } else {
        setErrorMsg(data.message || 'Failed to update company logo');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // Data Extraction: Platform Admin / Owner full export
  const handleExportData = async () => {
    setExporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/companies/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id }),
      });
      const data = await res.json();
      if (data.success && data.export) {
        // Create downloadable JSON blob
        const jsonStr = JSON.stringify(data.export, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const filenameSlug = company.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const dateStr = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `theysynced-export-${filenameSlug}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setSuccessMsg(
          `Workspace data extracted successfully (${data.export.metadata.total_messages} messages, ${data.export.metadata.total_assets} assets). Download initiated!`
        );
      } else {
        setErrorMsg(data.message || 'Failed to export workspace data');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error during data extraction');
    } finally {
      setExporting(false);
    }
  };

  // Touch Activity to reset 90-day inactivity timer
  const handleTouchActivity = async () => {
    setTouching(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/companies/touch-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id }),
      });
      const data = await res.json();
      if (data.success) {
        const updated = { ...company, last_activity_at: new Date().toISOString() };
        onCompanyUpdated(updated);
        setSuccessMsg('Workspace activity refreshed! The 90-day auto-purge clock has been reset.');
      } else {
        setErrorMsg(data.message || 'Failed to refresh activity');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setTouching(false);
    }
  };

  const handleLeaveCompany = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/companies/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id }),
      });
      const data = await res.json();
      if (data.success) {
        if (onCompanyLeft) {
          onCompanyLeft(company.id);
        } else {
          onCompanyDeleted(company.id);
        }
        onClose();
      } else {
        setErrorMsg(data.message || data.error || 'Failed to leave company');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (deleteConfirmName.trim() !== company.name.trim()) {
      setErrorMsg(`Please type "${company.name}" exactly to confirm permanent deletion.`);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/companies/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, company_id: company.id }),
      });
      const data = await res.json();
      if (data.success) {
        onCompanyDeleted(company.id);
        onClose();
      } else {
        setErrorMsg(data.message || 'Failed to delete company');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-3xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Sidebar Nav */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-100 p-6 space-y-1.5 flex flex-col">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">
            Company Governance
          </div>

          <button
            onClick={() => setActiveTab('general')}
            className={`w-full text-left px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
              activeTab === 'general' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>General & Branding</span>
          </button>

          <button
            onClick={() => setActiveTab('governance')}
            className={`w-full text-left px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
              activeTab === 'governance' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Data & Encryption</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`w-full text-left px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
              activeTab === 'members' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-500" />
            <span>Members & Roles</span>
          </button>

          {isOwner ? (
            <button
              onClick={() => setActiveTab('danger')}
              className={`w-full text-left px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 transition-all mt-auto ${
                activeTab === 'danger' ? 'bg-rose-600 text-white shadow-sm' : 'text-rose-600 hover:bg-rose-50'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              <span>Danger Zone (Delete)</span>
            </button>
          ) : (
            <button
              onClick={() => setActiveTab('leave')}
              className={`w-full text-left px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 transition-all mt-auto ${
                activeTab === 'leave' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 hover:bg-amber-50'
              }`}
            >
              <LogOut className="w-4 h-4" />
              <span>Leave Company</span>
            </button>
          )}
        </div>


        {/* Content Body */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          {errorMsg && (
            <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-medium flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-6">
              <form onSubmit={handleRename} className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Rename Company</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 px-4 py-2.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    required
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-slate-900 text-white rounded-full text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </form>

              <form onSubmit={handleUpdateLogo} className="space-y-3 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-bold text-slate-900">Company Logo & Avatar</h3>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-2xl object-cover border border-slate-200" />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-base">
                      {company.name.charAt(0)}
                    </div>
                  )}
                  <label className="cursor-pointer px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-full transition-all flex items-center gap-2">
                    <Image className="w-4 h-4" />
                    <span>Upload Logo</span>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="text-xs text-rose-600 hover:underline font-semibold"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {logoUrl && (
                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 px-5 py-2.5 bg-slate-900 text-white rounded-full text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    Save Logo
                  </button>
                )}
              </form>
            </div>
          )}

          {activeTab === 'governance' && (
            <div className="space-y-6">
              {/* Encryption at Rest Notice */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                    <Database className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-900">Organization AES-256-GCM Encryption at Rest</h4>
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    ACTIVE
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  All messages, documents, whiteboards, spreadsheets, and metadata in this organization are
                  cryptographically encrypted using <strong>AES-256-GCM AEAD</strong> with an isolated 256-bit key unique
                  to this workspace. Plaintext is never stored in the database.
                </p>
              </div>

              {/* Inactivity Policy & Auto-Purge Timer */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isCloseToPurge ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className={`w-4 h-4 ${isCloseToPurge ? 'text-amber-600' : 'text-slate-600'}`} />
                  <h4 className="text-xs font-bold text-slate-900">3-Month Inactivity Retention Policy</h4>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  To protect privacy and minimize inactive data exposure, workspaces with zero updates or activity for{' '}
                  <strong>90 days (3 months)</strong> are automatically and permanently purged from the database. No
                  restoration is possible after deletion.
                </p>
                <div className="flex items-center justify-between text-xs font-semibold pt-1">
                  <span className="text-slate-600">
                    Last active: <strong>{daysSinceActive === 0 ? 'Today' : `${daysSinceActive} day(s) ago`}</strong>
                  </span>
                  <span className={isCloseToPurge ? 'text-amber-700 font-bold' : 'text-slate-700'}>
                    Auto-purge in: <strong>{daysRemaining} day(s)</strong>
                  </span>
                </div>
                <button
                  onClick={handleTouchActivity}
                  disabled={touching}
                  className="w-full py-2.5 px-4 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${touching ? 'animate-spin' : ''}`} />
                  <span>{touching ? 'Refreshing Activity…' : 'Touch Workspace (Reset Inactivity Clock)'}</span>
                </button>
              </div>

              {/* Data Extraction Section */}
              {isAdminOrOwner && (
                <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 space-y-3">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-xs font-bold text-slate-900">Extract Workspace Archive</h4>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Export a full, decrypted sovereign package of this workspace containing all channels, chat histories,
                    whiteboards, documents, sheets, member registries, and cryptographic SHA-256 integrity checksums.
                  </p>
                  <button
                    onClick={handleExportData}
                    disabled={exporting}
                    className="w-full py-2.5 px-4 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{exporting ? 'Decrypting & Packaging Data…' : 'Download Complete Data Archive (.json)'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'danger' && isOwner && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-rose-600">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-sm font-bold">Danger Zone — Permanent Hard Purge</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Deleting this organization will <strong>permanently and irreversibly wipe</strong> all encrypted messages,
                team channels, assets (whiteboards, spreadsheets, documents), invites, and member associations across all
                database clusters. There is <strong>no possibility of restoration</strong>.
              </p>

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-6 py-3 bg-rose-600 text-white rounded-full text-xs font-bold hover:bg-rose-700 transition-all shadow-sm"
                >
                  Initiate Permanent Workspace Deletion
                </button>
              ) : (
                <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
                  <div className="text-xs font-bold text-rose-900">
                    Type <strong>{company.name}</strong> to confirm irreversible deletion:
                  </div>
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={company.name}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-rose-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleDeleteCompany}
                      disabled={loading || deleteConfirmName.trim() !== company.name.trim()}
                      className="px-5 py-2.5 bg-rose-600 text-white rounded-full text-xs font-bold hover:bg-rose-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Purging Workspace…' : 'Permanently Delete Everything'}
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmName('');
                      }}
                      className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-full text-xs font-semibold hover:bg-slate-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Organization Members</h3>
                  <p className="text-xs text-slate-500">Users with access to this encrypted workspace</p>
                </div>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full">
                  {(company.members || []).length} Members
                </span>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                {(company.members && company.members.length > 0 ? company.members : [
                  { user_id: company.owner_id, username: 'Owner', role: 'Owner', joined_at: company.created_at }
                ]).map((m: any, idx: number) => {
                  const isCurrent = m.user_id === user.id;
                  const isMemberOwner = m.user_id === company.owner_id || m.role === 'Owner';
                  return (
                    <div key={idx} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
                          {(m.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{m.username || 'Member'}</span>
                            {isCurrent && (
                              <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-semibold">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : 'recently'}
                          </div>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isMemberOwner ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {m.role || (isMemberOwner ? 'Owner' : 'Member')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'leave' && !isOwner && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-700">
                <LogOut className="w-5 h-5" />
                <h3 className="text-sm font-bold">Leave Organization</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Leaving <strong>{company.name}</strong> will revoke your access to all teams, encrypted chat channels,
                whiteboards, spreadsheets, documents, and Jira tasks in this workspace. You will need a new invite code to re-join.
              </p>

              {!showLeaveConfirm ? (
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="px-6 py-3 bg-amber-600 text-white rounded-full text-xs font-bold hover:bg-amber-700 transition-all shadow-sm"
                >
                  Leave this Company Workspace
                </button>
              ) : (
                <div className="p-5 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                  <div className="text-xs font-bold text-amber-900">
                    Are you sure you want to leave <strong>{company.name}</strong>?
                  </div>
                  <p className="text-xs text-amber-700">
                    Your personal user account will remain active, but you will be detached from this organization.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleLeaveCompany}
                      disabled={loading}
                      className="px-5 py-2.5 bg-amber-600 text-white rounded-full text-xs font-bold hover:bg-amber-700 transition-all disabled:opacity-40"
                    >
                      {loading ? 'Leaving Workspace…' : 'Yes, Confirm Leave Company'}
                    </button>
                    <button
                      onClick={() => setShowLeaveConfirm(false)}
                      className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-full text-xs font-semibold hover:bg-slate-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
