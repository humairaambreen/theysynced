'use client';

import React, { useState } from 'react';
import { UserProfile } from '../types';
import { X, Camera, ShieldCheck, Fingerprint, Lock, CheckCircle2, Sparkles, Key, LogOut } from 'lucide-react';
import { UserAvatar } from './UserAvatar';

interface UserSettingsModalProps {
  user: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onUpdateUser: (updatedUser: UserProfile) => void;
  onLogout?: () => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  user,
  isOpen,
  onClose,
  onUpdateUser,
  onLogout,
}) => {
  const [username, setUsername] = useState(user.username);
  const [avatarBase64, setAvatarBase64] = useState<string | undefined>(user.avatar_url);
  const [passkeyText, setPasskeyText] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPasskey, setSavingPasskey] = useState(false);
  const [webAuthnEnrolled, setWebAuthnEnrolled] = useState(Boolean(user.has_passkey));
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setMessage(null);

    const token = localStorage.getItem('theysynced_token');
    if (!token) return;

    try {
      const res = await fetch('/api/auth/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          username: username.trim(),
          avatar_url: avatarBase64,
        }),
      });

      const data = await res.json();
      if (data.success && data.user) {
        onUpdateUser(data.user);
        setMessage({ type: 'success', text: 'Profile & Avatar updated successfully!' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to update profile' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error updating profile' });
    } finally {
      setSavingProfile(false);
    }
  };

  // WebAuthn Biometric Touch ID / Face ID / Fingerprint Authentication
  const handleRegisterWebAuthn = async () => {
    setSavingPasskey(true);
    setMessage(null);

    try {
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn biometric authentication is not supported on this browser.');
      }

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userIdBytes = new TextEncoder().encode(user.id);

      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: { name: 'TheySynced Enterprise', id: window.location.hostname },
        user: {
          id: userIdBytes,
          name: user.username,
          displayName: user.username,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Touch ID / Fingerprint / Face ID
          userVerification: 'preferred',
        },
        timeout: 60000,
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      });

      if (credential) {
        const token = localStorage.getItem('theysynced_token');
        if (token) {
          const res = await fetch('/api/auth/passkey/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, passkey: `WEBAUTHN_${credential.id}` }),
          });
          const data = await res.json();
          if (data.success) {
            if (data.user) {
              onUpdateUser(data.user);
            }
            setMessage({ type: 'success', text: 'Biometric Touch ID / Fingerprint Passkey enrolled successfully!' });
          } else {
            setMessage({ type: 'error', text: data.message || 'Failed to save biometric passkey on server.' });
          }
        } else {
          setMessage({ type: 'error', text: 'Authentication token missing.' });
        }
      }
    } catch (err: any) {
      console.warn('WebAuthn error:', err);
      setMessage({ type: 'error', text: err.message || 'Biometric Touch ID prompt cancelled or unavailable.' });
    } finally {
      setSavingPasskey(false);
    }
  };

  const handleCustomPasskeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyText.trim()) return;
    setSavingPasskey(true);
    setMessage(null);

    const token = localStorage.getItem('theysynced_token');
    if (!token) return;

    try {
      const res = await fetch('/api/auth/passkey/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, passkey: passkeyText.trim() }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.user) {
          onUpdateUser(data.user);
        }
        setMessage({ type: 'success', text: 'Account Passkey updated successfully!' });
        setPasskeyText('');
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to set passkey' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error setting passkey' });
    } finally {
      setSavingPasskey(false);
    }
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    setSavingPasskey(true);
    setMessage(null);

    const token = localStorage.getItem('theysynced_token');
    if (!token) return;

    try {
      const res = await fetch('/api/auth/passkey/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, passkey_id: passkeyId }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.user) {
          onUpdateUser(data.user);
        }
        setMessage({ type: 'success', text: 'Passkey deleted successfully!' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to delete passkey.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error deleting passkey.' });
    } finally {
      setSavingPasskey(false);
    }
  };

  const enrolledCount = user.enrolled_passkeys?.length || 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4 font-sans select-none animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Profile & Biometric Passkey</h2>
              <p className="text-[10px] text-slate-500 font-medium">Customize avatar & biometric keys</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Content */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          
          {/* Status Message */}
          {message && (
            <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 border ${
              message.type === 'success' 
                ? 'bg-emerald-50 text-emerald-800 border-emerald-100/50' 
                : 'bg-rose-50 text-rose-800 border-rose-100/50'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <X className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Profile Form */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            
            <div className="flex items-center space-x-4">
              <div className="relative group">
                <UserAvatar seed={username} avatarUrl={avatarBase64} size={64} />
                <label className="absolute inset-0 flex items-center justify-center bg-slate-900/40 rounded-3xl opacity-0 group-hover:opacity-100 cursor-pointer transition-all">
                  <Camera className="w-5 h-5 text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              </div>

              <div className="flex-1">
                <label className="text-xs font-bold text-slate-700 block mb-1">Display Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:border-indigo-600 focus:outline-none bg-slate-50/50"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-sm flex items-center justify-center gap-1.5"
            >
              <span>{savingProfile ? 'Saving Profile...' : 'Save Profile & Avatar'}</span>
            </button>
          </form>

          {/* WebAuthn Biometric Fingerprint & Passkey Section */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Fingerprint className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Biometric Touch ID / Passkey</h3>
                  <p className="text-[11px] text-slate-500">Hardware security layer via WebAuthn</p>
                </div>
              </div>
              {enrolledCount > 0 && (
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span>{enrolledCount} Key{enrolledCount > 1 ? 's' : ''} Enrolled</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleRegisterWebAuthn}
              disabled={savingPasskey}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <Fingerprint className="w-4 h-4" />
              <span>
                {savingPasskey 
                  ? 'Scanning Biometrics...' 
                  : (enrolledCount > 0 ? 'Add another Touch ID / Fingerprint' : 'Add Touch ID / Fingerprint Passkey')}
              </span>
            </button>

            {/* Custom Secret Passkey Fallback */}
            <form onSubmit={handleCustomPasskeySubmit} className="pt-2 flex gap-2">
              <input
                type="password"
                placeholder="Or set custom secret passkey..."
                value={passkeyText}
                onChange={(e) => setPasskeyText(e.target.value)}
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold focus:border-indigo-600 focus:outline-none bg-slate-50/50"
              />
              <button
                type="submit"
                disabled={savingPasskey || !passkeyText.trim()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40"
              >
                Set Key
              </button>
            </form>

            {/* Enrolled Keys List */}
            {user.enrolled_passkeys && user.enrolled_passkeys.length > 0 && (
              <div className="pt-3 space-y-2">
                <h4 className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Enrolled Keys</h4>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {user.enrolled_passkeys.map((pkey) => (
                    <div key={pkey.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100/80">
                      <div className="flex items-center space-x-2">
                        <Key className="w-3.5 h-3.5 text-indigo-500" />
                        <div className="text-[11px] font-semibold text-slate-700">
                          {pkey.label}
                          <span className="text-[9px] text-slate-400 block font-normal">
                            Added {new Date(pkey.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(pkey.id)}
                        disabled={savingPasskey}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/80 px-2 py-1 rounded-lg transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Session Management (Log Out with confirmation) */}
            {onLogout && (
              <div className="mt-8 pt-6 border-t border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Session Management</h4>
                  <p className="text-[10px] text-slate-400">Sign out of your TheySynced account</p>
                </div>
                {confirmLogout ? (
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        onLogout();
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-bold transition-all shadow-sm"
                    >
                      Confirm Sign Out
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLogout(false)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full text-xs font-medium transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLogout(true)}
                    className="px-4 py-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-full text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                )}
              </div>
            )}

          </div>

        </div>

      </div>
    </div>
  );
};
