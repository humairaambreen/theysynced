'use client';

import React, { useState, useRef } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, ExternalLink, 
  Bookmark, Plus, X, Search, Lock, Compass, ShieldCheck
} from 'lucide-react';
import { Company, UserProfile, ActiveTab } from '../types';

interface BrowserViewProps {
  user: UserProfile;
  company: Company;
  initialUrl?: string;
  onNavigateTab?: (tab: ActiveTab, subItem?: string) => void;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
}

const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  { id: 'b-ddg', title: 'DuckDuckGo', url: 'https://duckduckgo.com' },
  { id: 'b-wiki', title: 'Wikipedia', url: 'https://en.m.wikipedia.org' },
  { id: 'b-hn', title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { id: 'b-mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
  { id: 'b-cf', title: 'Cloudflare Docs', url: 'https://developers.cloudflare.com' },
  { id: 'b-gh', title: 'GitHub', url: 'https://github.com' },
];

export const BrowserView: React.FC<BrowserViewProps> = ({
  user,
  company,
  initialUrl = 'https://duckduckgo.com',
  onNavigateTab,
}) => {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const saved = localStorage.getItem(`theysynced_bookmarks_${company.id}`);
      return saved ? JSON.parse(saved) : DEFAULT_BOOKMARKS;
    } catch {
      return DEFAULT_BOOKMARKS;
    }
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Normalize URL or Search Query
  const normalizeUrl = (input: string): string => {
    let trimmed = input.trim();
    if (!trimmed) return 'https://duckduckgo.com';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    // Check if it looks like a domain name
    if (trimmed.includes('.') && !trimmed.includes(' ')) {
      return `https://${trimmed}`;
    }
    // Otherwise treat as search query
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  };

  // Navigate to Target URL
  const navigateTo = (targetUrl: string) => {
    const cleanUrl = normalizeUrl(targetUrl);
    setUrlInput(cleanUrl);
    setCurrentUrl(cleanUrl);
    setLoadError(false);
    setIsLoading(true);

    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(cleanUrl);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      const url = history[newIdx];
      setUrlInput(url);
      setCurrentUrl(url);
      setLoadError(false);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      const url = history[newIdx];
      setUrlInput(url);
      setCurrentUrl(url);
      setLoadError(false);
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    setLoadError(false);
    if (iframeRef.current) {
      try {
        iframeRef.current.src = currentUrl;
      } catch (_) {}
    }
    setTimeout(() => setIsLoading(false), 600);
  };

  const handleGoHome = () => {
    navigateTo('https://duckduckgo.com');
  };

  const handleAddBookmark = () => {
    let hostname = '';
    try {
      hostname = new URL(currentUrl).hostname;
    } catch {
      hostname = currentUrl;
    }
    const title = prompt('Bookmark Title:', hostname) || hostname;
    if (!title) return;

    const newBm: BookmarkItem = {
      id: `bm-${Date.now()}`,
      title,
      url: currentUrl,
    };
    const updated = [...bookmarks, newBm];
    setBookmarks(updated);
    try {
      localStorage.setItem(`theysynced_bookmarks_${company.id}`, JSON.stringify(updated));
    } catch (_) {}
  };

  const handleRemoveBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    try {
      localStorage.setItem(`theysynced_bookmarks_${company.id}`, JSON.stringify(updated));
    } catch (_) {}
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0d14] text-slate-100 font-sans select-none overflow-hidden">
      
      {/* Top Browser Navigation Bar */}
      <div className="bg-[#12161f] border-b border-white/10 px-4 py-2 flex items-center space-x-3 shrink-0">
        
        {/* Navigation Controls */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleBack}
            disabled={historyIndex <= 0}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleForward}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleReload}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Reload Page"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <button
            onClick={handleGoHome}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Browser Home"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

        {/* Omnibox / URL Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(urlInput);
          }}
          className="flex-1 flex items-center bg-slate-900 border border-white/10 hover:border-white/20 focus-within:border-emerald-500 rounded-xl px-3 py-1.5 transition shadow-inner"
        >
          <Lock className="w-3.5 h-3.5 text-emerald-400 mr-2 shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Search web or enter website URL (e.g. wikipedia.org)..."
            className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 outline-none font-mono"
            spellCheck={false}
          />
          {urlInput && (
            <button
              type="button"
              onClick={() => setUrlInput('')}
              className="p-0.5 text-slate-500 hover:text-slate-300 ml-1"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </form>

        {/* Browser Quick Actions */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleAddBookmark}
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
            title="Bookmark Current Page"
          >
            <Bookmark className="w-4 h-4" />
          </button>

          <button
            onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Open in Native Browser Tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bookmarks Bar */}
      {showBookmarks && (
        <div className="bg-[#0e121a] border-b border-white/5 px-4 py-1.5 flex items-center space-x-2 overflow-x-auto text-[11px] shrink-0">
          <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider shrink-0 mr-1">
            Shortcuts:
          </span>
          {bookmarks.map((bm) => (
            <div
              key={bm.id}
              onClick={() => navigateTo(bm.url)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg cursor-pointer transition border shrink-0 ${
                currentUrl.startsWith(bm.url)
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 font-medium'
                  : 'bg-slate-900/60 border-white/5 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Globe className="w-3 h-3 text-slate-400" />
              <span>{bm.title}</span>
              <button
                onClick={(e) => handleRemoveBookmark(bm.id, e)}
                className="opacity-0 hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 ml-1"
                title="Remove Bookmark"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Browser Viewport */}
      <div className="relative flex-1 w-full h-full bg-slate-950 flex flex-col overflow-hidden">
        
        {/* Loading Indicator */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-800 z-10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 animate-pulse w-full" />
          </div>
        )}

        {/* Web Viewport Frame */}
        <iframe
          ref={iframeRef}
          src={currentUrl}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setLoadError(true);
          }}
          className="w-full flex-1 border-0 bg-white"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
          title="TheySynced Simple In-System Web Browser"
        />

        {/* Fallback Overlay for External Iframe-Restricted Sites */}
        {loadError && (
          <div className="absolute inset-0 bg-[#0a0d14]/95 flex flex-col items-center justify-center p-6 text-center space-y-4 font-sans">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center text-slate-400">
              <Compass className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-sm font-bold text-white">External Site Restrictions</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Some external websites (like Google or GitHub) restrict being embedded inside browser frames using <code className="text-slate-300 font-mono">X-Frame-Options</code>.
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
                className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow transition"
              >
                <span>Open in External Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => navigateTo('https://duckduckgo.com')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-white/10 transition"
              >
                Go to DuckDuckGo
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
