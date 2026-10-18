'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, ExternalLink, 
  Bookmark, Plus, X, Search, Terminal, Code2, AlertTriangle, 
  CheckCircle2, ShieldCheck, ShieldAlert, Laptop, Server, Send
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
  category: 'localhost' | 'dev' | 'custom';
}

const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  { id: 'b-lh3000', title: 'localhost:3000 (React / Next)', url: 'http://localhost:3000', category: 'localhost' },
  { id: 'b-lh8000', title: 'localhost:8000 (Python FastAPI)', url: 'http://localhost:8000', category: 'localhost' },
  { id: 'b-lh5173', title: 'localhost:5173 (Vite)', url: 'http://localhost:5173', category: 'localhost' },
  { id: 'b-lh8080', title: 'localhost:8080 (HTTP Server)', url: 'http://localhost:8080', category: 'localhost' },
  { id: 'b-cf', title: 'Cloudflare Docs', url: 'https://developers.cloudflare.com', category: 'dev' },
  { id: 'b-gh', title: 'GitHub', url: 'https://github.com', category: 'dev' },
  { id: 'b-mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', category: 'dev' },
];

export const BrowserView: React.FC<BrowserViewProps> = ({
  user,
  company,
  initialUrl = 'http://localhost:3000',
  onNavigateTab,
}) => {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<'iframe' | 'inspector'>(
    initialUrl.includes('localhost') || initialUrl.includes('127.0.0.1') ? 'inspector' : 'iframe'
  );
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const saved = localStorage.getItem(`theysynced_bookmarks_${company.id}`);
      return saved ? JSON.parse(saved) : DEFAULT_BOOKMARKS;
    } catch {
      return DEFAULT_BOOKMARKS;
    }
  });

  // Localhost Inspector State
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
  const [requestHeaders, setRequestHeaders] = useState('{\n  "Accept": "application/json"\n}');
  const [requestBody, setRequestBody] = useState('{\n  "test": true\n}');
  const [inspectorStatus, setInspectorStatus] = useState<number | null>(null);
  const [inspectorStatusText, setInspectorStatusText] = useState('');
  const [inspectorLatency, setInspectorLatency] = useState<number | null>(null);
  const [inspectorResponseHeaders, setInspectorResponseHeaders] = useState<Record<string, string>>({});
  const [inspectorResponseBody, setInspectorResponseBody] = useState<string>('');
  const [inspectorTab, setInspectorTab] = useState<'preview' | 'headers' | 'body_raw'>('preview');
  const [isInspectorLoading, setIsInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Normalize URL helper
  const normalizeUrl = (input: string): string => {
    let trimmed = input.trim();
    if (!trimmed) return 'about:blank';
    if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
      return `http://${trimmed}`;
    }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('about:')) {
      if (trimmed.includes('.') && !trimmed.includes(' ')) {
        return `https://${trimmed}`;
      } else {
        return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      }
    }
    return trimmed;
  };

  // Navigate to URL
  const navigateTo = (targetUrl: string) => {
    const cleanUrl = normalizeUrl(targetUrl);
    setUrlInput(cleanUrl);
    setCurrentUrl(cleanUrl);

    // If target is localhost or 127.0.0.1, auto-recommend inspector mode due to browser mixed-content policy on HTTPS
    if (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')) {
      setActiveMode('inspector');
    }

    // Add to history
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(cleanUrl);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);

    setIsLoading(true);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      const url = history[newIdx];
      setUrlInput(url);
      setCurrentUrl(url);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      const url = history[newIdx];
      setUrlInput(url);
      setCurrentUrl(url);
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    if (iframeRef.current) {
      try {
        iframeRef.current.src = currentUrl;
      } catch (_) {}
    }
    setTimeout(() => setIsLoading(false), 500);
  };

  const handleAddBookmark = () => {
    const title = prompt('Bookmark title:', currentUrl);
    if (!title) return;
    const isLh = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
    const newBm: BookmarkItem = {
      id: `bm-${Date.now()}`,
      title,
      url: currentUrl,
      category: isLh ? 'localhost' : 'custom',
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

  // Execute Inspector Request
  const runInspectorRequest = async () => {
    setIsInspectorLoading(true);
    setInspectorError(null);
    setInspectorStatus(null);
    setInspectorResponseBody('');

    const startTime = performance.now();
    try {
      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = JSON.parse(requestHeaders);
      } catch {
        parsedHeaders = { 'Accept': 'application/json' };
      }

      const reqOptions: RequestInit = {
        method: httpMethod,
        headers: parsedHeaders,
        mode: 'cors',
      };

      if ((httpMethod === 'POST' || httpMethod === 'PUT') && requestBody.trim()) {
        reqOptions.body = requestBody;
      }

      const res = await fetch(currentUrl, reqOptions);
      const latency = Math.round(performance.now() - startTime);
      setInspectorLatency(latency);
      setInspectorStatus(res.status);
      setInspectorStatusText(res.statusText || 'OK');

      const headerObj: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        headerObj[key] = val;
      });
      setInspectorResponseHeaders(headerObj);

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setInspectorResponseBody(JSON.stringify(json, null, 2));
      } catch {
        setInspectorResponseBody(text);
      }
    } catch (err: any) {
      const latency = Math.round(performance.now() - startTime);
      setInspectorLatency(latency);
      setInspectorStatus(0);
      setInspectorStatusText('Network / CORS Error');
      setInspectorError(
        err.message || 
        'Failed to fetch target URL. Ensure the local service is running and configured with CORS enabled, or open directly in a new tab.'
      );
    } finally {
      setIsInspectorLoading(false);
    }
  };

  const isLocalhost = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 font-sans select-none overflow-hidden">
      {/* Top Browser Chrome Navigation Bar */}
      <div className="bg-slate-950/90 border-b border-slate-800 px-4 py-2.5 flex items-center space-x-3 shrink-0">
        {/* Navigation Buttons */}
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
            title="Reload"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
          <button
            onClick={() => navigateTo('http://localhost:3000')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Home (localhost:3000)"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

        {/* Omnibox / URL Input */}
        <div className="flex-1 relative flex items-center">
          <div className="absolute left-3 flex items-center pointer-events-none">
            {isLocalhost ? (
              <Laptop className="w-4 h-4 text-emerald-400" />
            ) : currentUrl.startsWith('https://') ? (
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigateTo(urlInput);
              }
            }}
            placeholder="Search or enter web address (e.g., http://localhost:3000, https://github.com)"
            className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-9 pr-24 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition"
          />
          <div className="absolute right-2 flex items-center space-x-1">
            <button
              onClick={() => navigateTo(urlInput)}
              className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-semibold text-white transition shadow-sm"
            >
              Go
            </button>
            <button
              onClick={handleAddBookmark}
              className="p-1 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition"
              title="Bookmark current URL"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 shrink-0">
          <button
            onClick={() => setActiveMode('iframe')}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
              activeMode === 'iframe'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Web Preview</span>
          </button>
          <button
            onClick={() => setActiveMode('inspector')}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
              activeMode === 'inspector'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dev Inspector</span>
            {isLocalhost && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5"></span>}
          </button>
        </div>

        {/* External Popout Button */}
        <button
          onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
          title="Open in new browser tab / window"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Bookmarks Bar */}
      <div className="bg-slate-950/60 border-b border-slate-800/80 px-4 py-1.5 flex items-center space-x-2 overflow-x-auto text-[11px] shrink-0 no-scrollbar">
        <span className="text-slate-500 font-medium shrink-0 flex items-center space-x-1">
          <Bookmark className="w-3 h-3 text-slate-500" />
          <span>Quick:</span>
        </span>
        {bookmarks.map((bm) => (
          <button
            key={bm.id}
            onClick={() => navigateTo(bm.url)}
            className={`group flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs shrink-0 transition ${
              currentUrl === bm.url
                ? 'bg-indigo-950/60 border-indigo-700/60 text-indigo-300 font-semibold'
                : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {bm.category === 'localhost' ? (
              <Laptop className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <Globe className="w-3 h-3 text-slate-400 shrink-0" />
            )}
            <span className="truncate max-w-[140px]">{bm.title}</span>
            <span
              onClick={(e) => handleRemoveBookmark(bm.id, e)}
              className="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition ml-0.5 p-0.5 rounded"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative bg-slate-950 overflow-hidden flex flex-col">
        {/* MODE 1: Standard Iframe Web Preview */}
        {activeMode === 'iframe' && (
          <div className="w-full h-full flex flex-col relative">
            {isLocalhost && (
              <div className="bg-amber-950/80 border-b border-amber-800/60 px-4 py-2 flex items-center justify-between text-xs text-amber-200">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Localhost Notice:</strong> Modern browsers block embedding <code className="bg-amber-900/60 px-1 rounded font-mono">{currentUrl}</code> directly inside HTTPS iframes due to Mixed Content policies.
                  </span>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => setActiveMode('inspector')}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition text-[11px]"
                  >
                    Switch to Dev Inspector
                  </button>
                  <button
                    onClick={() => window.open(currentUrl, '_blank')}
                    className="px-2.5 py-1 rounded bg-amber-800/80 hover:bg-amber-700 text-amber-100 font-medium transition text-[11px] flex items-center space-x-1"
                  >
                    <span>Open in New Tab</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            <iframe
              ref={iframeRef}
              src={currentUrl}
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
              className="w-full flex-1 border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
              title="TheySynced In-System Browser"
            />
          </div>
        )}

        {/* MODE 2: Localhost & API Dev Inspector */}
        {activeMode === 'inspector' && (
          <div className="w-full h-full flex flex-col bg-slate-900 overflow-y-auto font-sans p-6">
            <div className="max-w-5xl w-full mx-auto space-y-5">
              {/* Header Banner */}
              <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow-md">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>Localhost & Endpoint Inspector</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Zero Mixed-Content Issues
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Query your local development servers, microservices, or APIs directly from TheySynced without iframe restrictions.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => window.open(currentUrl, '_blank')}
                  className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition"
                >
                  <span>Launch in Native Browser</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Request Builder Bar */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
                <div className="flex items-center space-x-2">
                  <select
                    value={httpMethod}
                    onChange={(e) => setHttpMethod(e.target.value as any)}
                    className="bg-slate-900 border border-slate-700 text-xs font-bold text-indigo-300 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>

                  <input
                    type="text"
                    value={currentUrl}
                    onChange={(e) => {
                      setCurrentUrl(e.target.value);
                      setUrlInput(e.target.value);
                    }}
                    placeholder="http://localhost:3000/api/health"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />

                  <button
                    onClick={runInspectorRequest}
                    disabled={isInspectorLoading}
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-2 transition shadow-md shadow-indigo-600/20"
                  >
                    {isInspectorLoading ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>{isInspectorLoading ? 'Sending...' : 'Send Request'}</span>
                  </button>
                </div>

                {/* Request Configuration (Headers / Body) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Request Headers (JSON)
                    </label>
                    <textarea
                      value={requestHeaders}
                      onChange={(e) => setRequestHeaders(e.target.value)}
                      rows={3}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {(httpMethod === 'POST' || httpMethod === 'PUT') && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Request Body (JSON / Text)
                      </label>
                      <textarea
                        value={requestBody}
                        onChange={(e) => setRequestBody(e.target.value)}
                        rows={3}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Response Panel */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
                <div className="bg-slate-900/80 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className="text-xs font-bold text-slate-300">Response</span>
                    {inspectorStatus !== null && (
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold font-mono ${
                            inspectorStatus >= 200 && inspectorStatus < 300
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : inspectorStatus >= 400
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {inspectorStatus} {inspectorStatusText}
                        </span>
                        {inspectorLatency !== null && (
                          <span className="text-[11px] text-slate-400 font-mono">
                            {inspectorLatency} ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setInspectorTab('preview')}
                      className={`px-3 py-1 rounded text-[11px] font-medium transition ${
                        inspectorTab === 'preview' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Formatted View
                    </button>
                    <button
                      onClick={() => setInspectorTab('body_raw')}
                      className={`px-3 py-1 rounded text-[11px] font-medium transition ${
                        inspectorTab === 'body_raw' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Raw
                    </button>
                    <button
                      onClick={() => setInspectorTab('headers')}
                      className={`px-3 py-1 rounded text-[11px] font-medium transition ${
                        inspectorTab === 'headers' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Headers ({Object.keys(inspectorResponseHeaders).length})
                    </button>
                  </div>
                </div>

                <div className="p-4 min-h-[260px] max-h-[500px] overflow-y-auto font-mono text-xs">
                  {inspectorError && (
                    <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-rose-300 space-y-2">
                      <div className="flex items-center space-x-2 font-bold text-rose-200">
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                        <span>Request Failed</span>
                      </div>
                      <p className="text-xs leading-relaxed">{inspectorError}</p>
                      <div className="pt-2 text-[11px] text-rose-400/80">
                        Tip: When running a local server on port 3000, 8000, etc., verify that CORS allows incoming requests or open the URL in a native browser tab.
                      </div>
                    </div>
                  )}

                  {!inspectorError && inspectorResponseBody && inspectorTab === 'preview' && (
                    <pre className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed bg-slate-950 p-4 rounded-xl border border-slate-900">
                      {inspectorResponseBody}
                    </pre>
                  )}

                  {!inspectorError && inspectorResponseBody && inspectorTab === 'body_raw' && (
                    <textarea
                      readOnly
                      value={inspectorResponseBody}
                      className="w-full h-80 bg-slate-950 border border-slate-900 rounded-xl p-4 text-slate-300 font-mono text-xs focus:outline-none"
                    />
                  )}

                  {!inspectorError && inspectorTab === 'headers' && (
                    <div className="space-y-1.5">
                      {Object.entries(inspectorResponseHeaders).map(([key, val]) => (
                        <div key={key} className="flex border-b border-slate-900 pb-1 text-xs">
                          <span className="w-48 font-bold text-indigo-300 shrink-0">{key}:</span>
                          <span className="text-slate-300 break-all">{val}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!inspectorError && !inspectorResponseBody && inspectorStatus === null && (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 space-y-2">
                      <Server className="w-8 h-8 text-slate-600 animate-pulse" />
                      <p className="text-xs">Click &ldquo;Send Request&rdquo; to test endpoint response.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
