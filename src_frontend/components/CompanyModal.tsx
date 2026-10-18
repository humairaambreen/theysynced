import React, { useState } from 'react';
import { Company } from '../types';
import { Building2, Key, X, Plus, Camera } from 'lucide-react';

interface CompanyModalProps {
  mode: 'create' | 'join';
  token: string;
  onClose: () => void;
  onCompanyCreatedOrJoined: (company: Company) => void;
}

export const CompanyModal: React.FC<CompanyModalProps> = ({
  mode,
  token,
  onClose,
  onCompanyCreatedOrJoined,
}) => {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const isCreate = mode === 'create';
    if (isCreate) {
      try {
        const res = await fetch('/api/companies/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, name: name.trim(), is_public: isPublic, logo_url: logoUrl }),
        });
        const data = await res.json();
        if (data.success && data.company) {
          onCompanyCreatedOrJoined(data.company);
          onClose();
        } else {
          setErrorMsg(data.message || 'Failed to create company');
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Network error');
      } finally {
        setLoading(false);
      }
    } else {
      let code = joinCode.trim();
      if (code.includes('/invite/')) {
        code = code.split('/invite/')[1] || code;
      }
      const isInvite = code.startsWith('invite_');
      const endpoint = isInvite ? '/api/invites/join' : '/api/companies/join';
      const body = isInvite ? { token, code } : { token, join_code: code.toUpperCase() };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success && data.company) {
          onCompanyCreatedOrJoined(data.company);
          onClose();
        } else {
          setErrorMsg(data.error || data.message || 'Failed to join company');
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Network error');
      } finally {
        setLoading(false);
      }
    }

  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl border border-black/[0.06] p-8 md:p-10 relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#E0E3FF] text-[#181A2A] flex items-center justify-center mx-auto mb-3">
            {mode === 'create' ? <Building2 className="w-6 h-6" /> : <Key className="w-6 h-6" />}
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {mode === 'create' ? 'Create Company' : 'Join Existing Company'}
          </h2>
          <p className="text-slate-500 text-xs font-light mt-1">
            {mode === 'create'
              ? 'Set up a new organization workspace for your team'
              : 'Enter the company join code provided by your organization'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 text-rose-600 text-xs font-medium text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' ? (
            <>
               <div className="flex flex-col items-center mb-4">
                 <label className="text-xs font-bold text-slate-700 mb-1.5 self-start pl-1">
                   Company Logo / Avatar
                 </label>
                 <div className="relative group w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center border-2 border-dashed border-slate-300 hover:border-indigo-600 transition-colors overflow-hidden">
                   {logoUrl ? (
                     <img src={logoUrl} alt="Logo Preview" className="w-full h-full object-cover" />
                   ) : (
                     <Building2 className="w-8 h-8 text-slate-400" />
                   )}
                   <label className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                     <Camera className="w-5 h-5" />
                     <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                   </label>
                 </div>
               </div>

               <div>
                 <label className="block text-xs font-semibold text-slate-700 mb-1.5 pl-1">
                   Company Name
                 </label>
                 <input
                   type="text"
                   value={name}
                   onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. Acme Corp or TechNova"
                   className="w-full px-4 py-3 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                   required
                 />
               </div>


              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <div className="text-xs font-bold text-slate-900">Public Company Website</div>
                  <div className="text-[11px] text-slate-500">Allow a public showcase microsite at /c/company_id</div>
                </div>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                />
              </div>
            </>
          ) : (
             <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 pl-1">
                Join Code or Invite Link/Code
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. invite_a8Fj2k9 or TS-A7CDDD"
                className="w-full px-4 py-3 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                required
              />
              <p className="text-[11px] text-slate-400 mt-1 pl-1">Enter your team's join code or paste a secure invite link.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-6 rounded-full bg-slate-900 text-white font-semibold text-xs tracking-wide shadow-md hover:scale-[1.01] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 mt-6"
          >
            <Plus className="w-4 h-4" />
            <span>{loading ? 'Processing...' : mode === 'create' ? 'Create Company' : 'Join Company'}</span>
          </button>
        </form>

      </div>
    </div>
  );
};
