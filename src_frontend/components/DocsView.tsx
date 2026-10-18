'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Company, UserProfile, WorkspaceAsset } from '../types';
import { FileText, Bold, Italic, Code, List, Save, Check, HardDrive, ListOrdered, Globe, Lock, Eye } from 'lucide-react';
import { saveAssetOffline, getAssetOffline } from '../lib/offlineStore';

interface DocsViewProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
  onSaveAsset: (name: string, content: string, scope?: 'shared' | 'private') => void;
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
  const [workspaceScope, setWorkspaceScope] = useState<'shared' | 'private'>('shared');
  const [docTitle, setDocTitle] = useState('Workspace Master Document');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');

  const currentAssetId = workspaceScope === 'shared' 
    ? `doc_${company.id}` 
    : `doc_${company.id}_user_${user.id}`;

  const initialHtml = `
    <h2>Welcome to Collaborative Workspace Docs</h2>
    <p>This document syncs in real-time. You can format headings, bold/italic text, create bullet lists, code blocks, and draft project specs effortlessly.</p>
  `;

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    immediatelyRender: false,
    editable: !isViewer,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      
      // Only broadcast over WebSocket if we are in shared mode
      if (workspaceScope === 'shared' && websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'doc_update', content: html }));
      }

      saveAssetOffline({
        id: currentAssetId,
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
              id: currentAssetId,
              company_id: company.id,
              name: docTitle,
              asset_type: 'doc',
              content: html,
              created_by: user.username,
              updated_at: new Date().toISOString(),
              scope: workspaceScope,
            }
          }),
        }).catch(() => {});
      }
    },
  });

  // Restore content when switching scope or mounting
  useEffect(() => {
    (async () => {
      const onlineDoc = assets.find((a) => a.id === currentAssetId);
      if (onlineDoc && onlineDoc.content && editor) {
        editor.commands.setContent(onlineDoc.content);
        if (onlineDoc.name) setDocTitle(onlineDoc.name);
        await saveAssetOffline({
          id: currentAssetId,
          company_id: company.id,
          title: onlineDoc.name || docTitle,
          asset_type: 'document',
          content: onlineDoc.content,
        });
      } else {
        const offline = await getAssetOffline(currentAssetId);
        if (offline && offline.content && editor) {
          editor.commands.setContent(offline.content);
          if (offline.title) setDocTitle(offline.title);
        } else if (editor) {
          if (workspaceScope === 'private') {
            editor.commands.setContent(`<h2>My Private Notes</h2><p>This personal document is only visible to you (@${user.username}).</p>`);
            setDocTitle('My Private Notes');
          } else {
            editor.commands.setContent(initialHtml);
            setDocTitle('Workspace Master Document');
          }
        }
      }
    })();
  }, [company.id, editor, workspaceScope, user.id]);

  // WebSocket sync for shared documents
  useEffect(() => {
    if (!websocket || !editor || workspaceScope !== 'shared') return;
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
  }, [websocket, editor, user.id, workspaceScope]);

  const handleManualSave = async () => {
    if (!editor) return;
    setSaveStatus('saving');
    const content = editor.getHTML();
    await saveAssetOffline({
      id: currentAssetId,
      company_id: company.id,
      title: docTitle,
      asset_type: 'document',
      content,
    });
    onSaveAsset(docTitle, content, workspaceScope);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      
      {/* Header Bar */}
      <div className="px-4 md:px-6 py-3 border-b border-black/[0.06] flex flex-col md:flex-row md:items-center justify-between bg-white z-10 shadow-sm gap-3 shrink-0">
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
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
              <HardDrive className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>TipTap Rich Collaborative Documentation Engine</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 w-full md:w-auto overflow-x-auto flex-nowrap pb-1 scrollbar-none shrink-0">
          
          {/* Shared vs Private Segmented Control */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setWorkspaceScope('shared')}
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all ${
                workspaceScope === 'shared' 
                  ? 'bg-white text-indigo-600 shadow-sm font-bold' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Shared (Team)</span>
            </button>
            <button
              onClick={() => setWorkspaceScope('private')}
              className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all ${
                workspaceScope === 'private' 
                  ? 'bg-white text-emerald-600 shadow-sm font-bold' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Private (Only You)</span>
            </button>
          </div>

          {isViewer ? (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold shrink-0">
              <Eye className="w-3.5 h-3.5" />
              <span>View Only</span>
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              className="px-4 py-1.5 bg-slate-950 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-1.5 shadow-sm shrink-0 active:scale-95"
            >
              {saveStatus === 'saved' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Saved</span>
                </>
              ) : saveStatus === 'saving' ? (
                <span>Saving...</span>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Doc</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-6 bg-slate-50">
        <div className="max-w-4xl w-full mx-auto flex-1 bg-white rounded-3xl border border-slate-200/80 shadow-md flex flex-col overflow-hidden">
          
          {/* Formatting Toolbar */}
          {editor && !isViewer && (
            <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center space-x-1.5 text-xs overflow-x-auto scrollbar-none shrink-0 w-full">
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

              <div className="ml-auto flex items-center space-x-1.5 text-[11px] font-semibold text-slate-400">
                {workspaceScope === 'private' ? (
                  <span className="flex items-center text-emerald-600 gap-1 bg-emerald-50 px-2 py-0.5 rounded-md">
                    <Lock className="w-3 h-3" /> Private to @{user.username}
                  </span>
                ) : (
                  <span className="flex items-center text-indigo-600 gap-1 bg-indigo-50 px-2 py-0.5 rounded-md">
                    <Globe className="w-3 h-3" /> Shared with Team
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TipTap Content Area */}
          <div className="flex-1 p-8 overflow-y-auto prose max-w-none focus:outline-none text-slate-800">
            <EditorContent editor={editor} />
          </div>

        </div>
      </div>

    </div>
  );
};
