import React, { useState } from 'react';
import { User, Lock, ArrowRight, Fingerprint } from 'iconoir-react';
import { Eye, EyeOff } from 'lucide-react';

interface AuthModalProps {
  onLoginSuccess: (token: string, user: any) => void;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onLoginSuccess, onClose }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Passkey challenge step — only entered when the account already has a
  // passkey enrolled and the password step just came back asking for it.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [passkeyText, setPasskeyText] = useState('');
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [verifyingPasskey, setVerifyingPasskey] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter username and password');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const endpoint = isSignUp ? '/api/auth/register' : '/api/auth/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });
      const data = await res.json();

      if (data.success && data.requires_passkey && data.pending_token) {
        // Password was correct — now ask for the passkey before granting a session.
        setPendingToken(data.pending_token);
        attemptWebAuthnGet(data.pending_token);
      } else if (data.success && data.token && data.user) {
        localStorage.setItem('theysynced_token', data.token);
        onLoginSuccess(data.token, data.user);
      } else {
        setErrorMsg(data.message || 'Authentication failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const finishPasskeyLogin = async (token: string, passkey: string) => {
    setVerifyingPasskey(true);
    setPasskeyError(null);
    try {
      const res = await fetch('/api/auth/login/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: token, passkey }),
      });
      const data = await res.json();
      if (data.success && data.token && data.user) {
        localStorage.setItem('theysynced_token', data.token);
        onLoginSuccess(data.token, data.user);
      } else {
        setPasskeyError(data.message || 'Passkey verification failed');
      }
    } catch (err: any) {
      setPasskeyError(err.message || 'Network error');
    } finally {
      setVerifyingPasskey(false);
    }
  };

  // Prompts Face ID / Touch ID / platform authenticator via WebAuthn, matching
  // the same "WEBAUTHN_<credential.id>" format used when the passkey was enrolled.
  const attemptWebAuthnGet = async (token: string) => {
    if (!window.PublicKeyCredential) return;
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      });

      if (credential) {
        await finishPasskeyLogin(token, `WEBAUTHN_${credential.id}`);
      }
    } catch (err) {
      // User cancelled the biometric prompt, or it isn't available — that's
      // fine, they can still type the custom passkey below.
    }
  };

  const handlePasskeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingToken || !passkeyText.trim()) return;
    finishPasskeyLogin(pendingToken, passkeyText.trim());
  };

  if (pendingToken) {
    return (
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl border border-black/[0.06] p-8 md:p-10 relative overflow-hidden">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-6 right-6 w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center text-sm transition-colors z-10"
            type="button"
          >
            ✕
          </button>
        )}

        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-thin text-slate-900 tracking-tight">Confirm it&apos;s you</h2>
          <p className="text-slate-500 text-xs md:text-sm font-light mt-1">
            Your password checked out. This account has a passkey enrolled — verify with Face ID, Touch ID, or your device passkey.
          </p>
        </div>

        {passkeyError && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium text-center">
            {passkeyError}
          </div>
        )}

        <button
          onClick={() => attemptWebAuthnGet(pendingToken)}
          disabled={verifyingPasskey}
          className="w-full py-3.5 px-6 rounded-full bg-slate-900 text-white font-medium text-xs tracking-wide shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          <Fingerprint className="w-4 h-4" strokeWidth={1.75} />
          <span>{verifyingPasskey ? 'Verifying...' : 'Verify with passkey'}</span>
        </button>

        <div className="my-6 flex items-center gap-3 text-[11px] text-slate-400 font-medium">
          <div className="h-px flex-1 bg-slate-200" />
          <span>OR ENTER MANUALLY</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handlePasskeySubmit} className="space-y-4">
          <input
            type="password"
            value={passkeyText}
            onChange={(e) => setPasskeyText(e.target.value)}
            placeholder="Your custom passkey"
            className="w-full px-4 py-3 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
          />
          <button
            type="submit"
            disabled={verifyingPasskey || !passkeyText.trim()}
            className="w-full py-3 px-6 rounded-full bg-slate-100 text-slate-900 font-medium text-xs tracking-wide hover:bg-slate-200 transition-all disabled:opacity-50"
          >
            Submit passkey
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setPendingToken(null);
              setPasskeyText('');
              setPasskeyError(null);
            }}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl border border-black/[0.06] p-8 md:p-10 relative overflow-hidden">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-6 right-6 w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center text-sm transition-colors z-10"
          type="button"
        >
          ✕
        </button>
      )}

      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-thin text-slate-900 tracking-tight">
          {isSignUp ? 'Join TheySynced' : 'Welcome back'}
        </h2>
        <p className="text-slate-500 text-xs md:text-sm font-light mt-1">
          Sign in to access your company teams & collaborative apps
        </p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium text-center">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5 pl-1">
            Username
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" strokeWidth={1.75} />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alex_developer"
              className="w-full pl-11 pr-4 py-3 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5 pl-1">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" strokeWidth={1.75} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-11 pr-12 py-3 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600 focus:outline-none"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-6 rounded-full bg-slate-900 text-white font-medium text-xs tracking-wide shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 mt-6"
        >
          <span>{loading ? 'Authenticating...' : isSignUp ? 'Create Account' : 'Sign In'}</span>
          <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setErrorMsg(null);
          }}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
        </button>
      </div>

    </div>
  );
};
