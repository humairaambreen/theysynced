import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Trash2, Clock, Shield, Users, Plus } from 'lucide-react';
import { Company } from '../types';

import { ConfirmModal } from './ConfirmModal';

interface InviteModalProps {
  company: Company;
  token: string;
  onClose: () => void;
}

interface InviteLink {
  code: string;
  company_id: string;
  creator_id: string;
  role: 'Owner' | 'Admin' | 'Moderator' | 'Member' | 'Guest';
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export const InviteModal: React.FC<InviteModalProps> = ({ company, token, onClose }) => {
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

  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [role, setRole] = useState<'Admin' | 'Moderator' | 'Member' | 'Guest'>('Member');
  const [duration, setDuration] = useState<string>('1440'); // default 24h (1440 mins)
  const [maxUses, setMaxUses] = useState<string>('unlimited');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchInvites = async () => {
    try {
      const res = await fetch(`/api/invites/list?token=${token}&company_id=${company.id}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.invites)) {
        setInvites(data.invites);
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchInvites();
  }, [company.id]);

  const handleCreate = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const body = {
        token,
        company_id: company.id,
        role,
        duration_mins: duration === 'never' ? null : parseInt(duration),
        max_uses: maxUses === 'unlimited' ? null : parseInt(maxUses),
      };

      const res = await fetch('/api/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        fetchInvites();
      } else {
        setErrorMsg(data.error || 'Failed to create invite link');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = (code: string) => {
    triggerConfirm(
      'Revoke Invite Link',
      'Are you sure you want to revoke this invite link? Anyone using it will no longer be able to join.',
      async () => {
        try {
          const res = await fetch('/api/invites/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, company_id: company.id, code }),
          });
          const data = await res.json();
          if (data.success) {
            setInvites((prev) => prev.filter((inv) => inv.code !== code));
          }
        } catch (e) {
          // ignore
        }
      }
    );
  };

  const copyLink = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/invite/${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return 'Never';
    const d = new Date(expiresAt);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs <= 0) return 'Expired';
    
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60) return `Expires in ${diffMins}m`;
    const diffHrs = Math.round(diffMins / 60);
    if (diffHrs < 24) return `Expires in ${diffHrs}h`;
    const diffDays = Math.round(diffHrs / 24);
    return `Expires in ${diffDays}d`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="w-full max-w-lg bg-white rounded-[40px] shadow-2xl border border-black/[0.06] p-8 md:p-10 relative">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-6 h-6 text-indigo-600" />
            <span>Invite Members to {company.name}</span>
          </h2>
          <p className="text-slate-500 text-xs font-light mt-1">
            Configure and generate Discord-like invite links with custom restrictions.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 text-rose-600 text-xs font-medium text-center">
            {errorMsg}
          </div>
        )}

        {/* Configuration Panel */}
        <div className="bg-slate-50 rounded-3xl p-5 border border-slate-200/60 mb-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {/* Expiry Dropdown */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Expires After
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="360">6 hours</option>
                <option value="1440">24 hours</option>
                <option value="never">Never</option>
              </select>
            </div>

            {/* Max Uses Dropdown */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Max Uses
              </label>
              <select
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="unlimited">No limit</option>
                <option value="1">1 use</option>
                <option value="5">5 uses</option>
                <option value="10">10 uses</option>
                <option value="25">25 uses</option>
              </select>
            </div>

            {/* Assign Role Dropdown */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Assign Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="Guest">👁 Guest — Read-only access to tools</option>
                <option value="Member">Member</option>
                <option value="Moderator">Moderator</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{loading ? 'Generating...' : 'Generate Invite Link'}</span>
          </button>
        </div>

        {/* Active Invites List */}
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Active Invite Links ({invites.length})
          </h3>

          {invites.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-slate-200 rounded-3xl text-slate-400 text-xs font-light">
              No active invite links. Create one above to invite your team!
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {invites.map((inv) => (
                <div
                  key={inv.code}
                  className="flex items-center justify-between p-3.5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-slate-200 transition-colors"
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-mono text-xs font-semibold text-slate-800 truncate">
                        {inv.code}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-semibold">
                        {inv.role}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3 text-[10px] text-slate-400 mt-1">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3 text-slate-300" />
                        <span>{formatExpiry(inv.expires_at)}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center space-x-1">
                        <Users className="w-3 h-3 text-slate-300" />
                        <span>
                          {inv.uses} / {inv.max_uses ?? '∞'} joins
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => copyLink(inv.code)}
                      className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
                      title="Copy URL link"
                    >
                      {copiedCode === inv.code ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 animate-scale-up" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleRevoke(inv.code)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      title="Revoke link"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
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
