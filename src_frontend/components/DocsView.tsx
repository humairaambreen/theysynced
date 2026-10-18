'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Company, UserProfile, WorkspaceAsset } from '../types';
import { FileText, Bold, Italic, Code, List, FileUp, Save, Check, HardDrive, ListOrdered, Printer, ZoomIn, ZoomOut, RotateCcw, Download, Eye } from 'lucide-react';
import { saveAssetOffline, getAssetOffline } from '../lib/offlineStore';

interface DocsViewProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
  onSaveAsset: (name: string, content: string) => void;
  assets: WorkspaceAsset[];
  isViewer?: boolean;
}

export const DocsView: React.FC<DocsViewProps> = ({
  user,
  company,
  websocket,
  onSaveAsset,
  assets,
  isViewer = false,
}) => {
  const [docTitle, setDocTitle] = useState('Workspace Master Document');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [docMode, setDocMode] = useState<'editor' | 'pdf'>('editor');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfZoom, setPdfZoom] = useState<number>(100);
  const initialHtml = `
    <h2>Welcome to the Collaborative Workspace Document</h2>
    <p>This document syncs in real-time with all active team members. You can format text, create bullet lists, and draft project requirements collaboratively.</p>
  `;

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    immediatelyRender: false,
    editable: !isViewer,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'doc_update', content: html }));
      }
      saveAssetOffline({
        id: `doc_${company.id}`,
        company_id: company.id,
        title: docTitle,
        asset_type: 'document',
        content: html,
      });

      const token = localStorage.getItem('theysynced_token');
      if (token) {
        fetch('/api/assets/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            company_id: company.id,
            asset: {
              id: `doc_${company.id}`,
              company_id: company.id,
              title: docTitle,
              asset_type: 'doc',
              content: html,
              created_by: user.username,
              updated_at: new Date().toISOString(),
            }
          }),
        }).catch(() => {});
      }
    },
  });

  const hasLoadedRef = useRef<string | null>(null);

  // Restore content from online asset or offline store
  useEffect(() => {
    if (hasLoadedRef.current === company.id) return;

    (async () => {
      // 1. Restore text document
      const onlineDoc = assets.find((a) => a.id === `doc_${company.id}`);
      if (onlineDoc && onlineDoc.content && editor) {
        editor.commands.setContent(onlineDoc.content);
        await saveAssetOffline({
          id: `doc_${company.id}`,
          company_id: company.id,
          title: docTitle,
          asset_type: 'document',
          content: onlineDoc.content,
        });
        hasLoadedRef.current = company.id;
      } else {
        const offline = await getAssetOffline(`doc_${company.id}`);
        if (offline && offline.content && editor) {
          editor.commands.setContent(offline.content);
          hasLoadedRef.current = company.id;
        }
      }

      // 2. Restore PDF document
      const onlinePdf = assets.find((a) => a.id === `pdf_${company.id}`);
      if (onlinePdf && onlinePdf.content) {
        setPdfUrl(onlinePdf.content);
        setDocMode('pdf');
        await saveAssetOffline({
          id: `pdf_${company.id}`,
          company_id: company.id,
          title: onlinePdf.name,
          asset_type: 'pdf',
          content: onlinePdf.content,
        });
        hasLoadedRef.current = company.id;
      } else {
        const offlinePdf = await getAssetOffline(`pdf_${company.id}`);
        if (offlinePdf && offlinePdf.content) {
          setPdfUrl(offlinePdf.content);
          setDocMode('pdf');
          hasLoadedRef.current = company.id;
        }
      }
    })();
  }, [company.id, editor, assets]);

  // WebSocket sync
  useEffect(() => {
    if (!websocket || !editor) return;
    const handleWs = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'init' && data.state && data.state.document_content) {
          editor.commands.setContent(data.state.document_content);
        } else if (data.type === 'doc_update' && data.content && data.user_id !== user.id) {
          editor.commands.setContent(data.content);
        }
      } catch (err) {
        // ignore
      }
    };
    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, editor, user.id]);

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        setPdfUrl(base64data);
        setDocMode('pdf');

        await saveAssetOffline({
          id: `pdf_${company.id}`,
          company_id: company.id,
          title: file.name,
          asset_type: 'pdf',
          content: base64data,
        });

        const token = localStorage.getItem('theysynced_token');
        if (token) {
          fetch('/api/assets/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              company_id: company.id,
              asset: {
                id: `pdf_${company.id}`,
                company_id: company.id,
                title: file.name,
                asset_type: 'pdf',
                content: base64data,
                created_by: user.username,
                updated_at: new Date().toISOString(),
              }
            }),
          }).catch(() => {});
        }
      };
      reader.readAsDataURL(file);
    }
  };


  const handlePrintDoc = () => {
    window.print();
  };

  const handleManualSave = async () => {
    if (!editor) return;
    setSaveStatus('saving');
    const content = editor.getHTML();
    await saveAssetOffline({
      id: `doc_${company.id}`,
      company_id: company.id,
      title: docTitle,
      asset_type: 'document',
      content,
    });
    onSaveAsset(docTitle, content);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      
      {/* Header Bar */}
      <div className="px-4 md:px-6 py-3 border-b border-black/[0.06] flex flex-col md:flex-row md:items-center justify-between bg-white z-10 shadow-sm gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <input
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="text-sm font-bold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-sky-600 focus:outline-none bg-transparent w-full"
            />
            <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
              <HardDrive className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="truncate">TipTap Block Document Suite • PDF Rendering & Print Engine</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 w-full md:w-auto overflow-x-auto flex-nowrap pb-1 scrollbar-none shrink-0">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-full border border-slate-200 text-[10px] sm:text-xs font-semibold">
            <button
              onClick={() => setDocMode('editor')}
              className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full transition-all ${
                docMode === 'editor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span className="hidden sm:inline">Block Editor</span>
              <span className="sm:hidden">Editor</span>
            </button>
            <button
              onClick={() => setDocMode('pdf')}
              className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full transition-all ${
                docMode === 'pdf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span className="hidden sm:inline">PDF Suite</span>
              <span className="sm:hidden">PDF</span>
            </button>
          </div>

          {!isViewer && (
            <label className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center gap-1 transition-all shrink-0">
              <FileUp className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              <span className="hidden sm:inline">Upload PDF</span>
              <span className="sm:hidden">Upload</span>
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
            </label>
          )}

          <button
            onClick={handlePrintDoc}
            className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 flex items-center gap-1 transition-all shrink-0"
          >
            <Printer className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            <span className="hidden sm:inline">Print / PDF</span>
            <span className="sm:hidden">Print</span>
          </button>

          {isViewer ? (
            <span className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-[10px] sm:text-xs font-bold shrink-0">
              <Eye className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              View Only
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              className="px-2.5 sm:px-4 py-1 sm:py-1.5 bg-slate-900 text-white rounded-full text-[10px] sm:text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-1 shadow-sm shrink-0"
            >
              {saveStatus === 'saved' ? (
                <>
                  <Check className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-400" />
                  <span>Saved</span>
                </>
              ) : saveStatus === 'saving' ? (
                <span>Saving...</span>
              ) : (
                <>
                  <Save className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                  <span className="hidden sm:inline">Save Doc</span>
                  <span className="sm:hidden">Save</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Editor Content */}
      {docMode === 'editor' ? (
        <div className="flex-1 flex flex-col overflow-hidden p-6 bg-slate-50">
          <div className="max-w-4xl w-full mx-auto flex-1 bg-white rounded-3xl border border-slate-200/80 shadow-md flex flex-col overflow-hidden">
            
            {/* Formatting Toolbar — hidden for viewers */}
            {editor && !isViewer && (
              <div className="px-4 md:px-6 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center space-x-1.5 text-xs overflow-x-auto scrollbar-none shrink-0 w-full">
                <button
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  className={`px-2.5 py-1 rounded font-bold transition-all ${editor.isActive('heading', { level: 1 }) ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  H1
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className={`px-2.5 py-1 rounded font-bold transition-all ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  H2
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={`p-1.5 rounded transition-all ${editor.isActive('bold') ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={`p-1.5 rounded transition-all ${editor.isActive('italic') ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  className={`p-1.5 rounded transition-all ${editor.isActive('bulletList') ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  className={`p-1.5 rounded transition-all ${editor.isActive('orderedList') ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  className={`p-1.5 rounded transition-all ${editor.isActive('codeBlock') ? 'bg-slate-900 text-white' : 'bg-white border text-slate-700'}`}
                >
                  <Code className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* TipTap Content Area */}
            <div className="flex-1 p-8 overflow-y-auto prose max-w-none focus:outline-none text-slate-800">
              <EditorContent editor={editor} />
            </div>

          </div>
        </div>
      ) : (
        /* PDF Viewer & Document Interactive Suite */
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
          
          {/* PDF Toolbar */}
          <div className="px-6 py-2 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center space-x-2">
              <Eye className="w-4 h-4 text-sky-400" />
              <span className="font-semibold">{pdfUrl ? 'Uploaded PDF Document' : 'Default Architecture Blueprint.pdf'}</span>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1 bg-slate-900/60 px-2 py-1 rounded-lg">
                <button onClick={() => setPdfZoom(Math.max(50, pdfZoom - 10))} className="p-1 hover:text-white">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[11px] w-12 text-center">{pdfZoom}%</span>
                <button onClick={() => setPdfZoom(Math.min(200, pdfZoom + 10))} className="p-1 hover:text-white">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setPdfZoom(100)} className="p-1 hover:text-white ml-1">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              <label className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold cursor-pointer transition-all flex items-center gap-1">
                <FileUp className="w-3 h-3" />
                <span>Choose PDF File</span>
                <input type="file" accept="application/pdf" onChange={handlePdfUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Render PDF or Interactive Blueprint Document */}
          <div className="flex-1 overflow-auto p-6 flex justify-center items-start">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                style={{ transform: `scale(${pdfZoom / 100})`, transformOrigin: 'top center' }}
                className="w-full max-w-4xl h-full rounded-2xl border border-slate-700 shadow-2xl transition-all"
              />
            ) : (
              /* Built-in Sample PDF Preview Page */
              <div
                style={{ transform: `scale(${pdfZoom / 100})`, transformOrigin: 'top center' }}
                className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl p-12 text-slate-900 space-y-6 transition-all border border-slate-700"
              >
                <div className="border-b border-slate-200 pb-6 flex items-center justify-between">
                  <div>
                    <span className="px-2.5 py-1 bg-sky-100 text-sky-800 rounded-full text-[10px] font-extrabold uppercase tracking-wider">
                      CONFIDENTIAL PDF SPECIFICATION
                    </span>
                    <h1 className="text-2xl font-black mt-2 text-slate-900">{company.name} System Architecture</h1>
                    <p className="text-xs text-slate-500 mt-1">Generated for @{user.username} • TheySynced v0.2.0 Enterprise Engine</p>
                  </div>
                  <FileText className="w-12 h-12 text-sky-600" />
                </div>

                <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                  <h3 className="text-sm font-bold text-slate-900 border-l-4 border-sky-600 pl-3">1. WebRTC & Multi-User WebSocket Synchronization</h3>
                  <p>
                    TheySynced delivers low-latency peer-to-peer audio/video streaming via WebRTC mesh networks backed by a high-throughput Rust Axum engine running on port 8000.
                  </p>
                  
                  <h3 className="text-sm font-bold text-slate-900 border-l-4 border-sky-600 pl-3">2. Document & PDF Processing Pipeline</h3>
                  <p>
                    Users can render interactive PDF blueprints directly within the browser, inspect exact vector layers, or print rich TipTap block documentation to PDF formats seamlessly.
                  </p>

                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-800">
                    <div>[Document Security Digest]</div>
                    <div>SHA-256: 8f9b2e1a4c6d3f0e8b7a6c5d4e3f2a1b</div>
                    <div>Encryption: RSA-4096 / TLS 1.3 Active</div>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400">
                  <span>Page 1 of 1 • TheySynced PDF Suite</span>
                  <span>Click "Choose PDF File" above to load custom PDF files.</span>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
};
