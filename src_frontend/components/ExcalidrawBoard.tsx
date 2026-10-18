'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Company, UserProfile } from '../types';
import { Download, Save, RefreshCw, Check, HardDrive, PenTool, Eye, Globe, Lock } from 'lucide-react';

import { saveAssetOffline, getAssetOffline } from '../lib/offlineStore';
import defaultDrawing from '../lib/defaultDrawing.json';
import '@excalidraw/excalidraw/index.css';

// Dynamically import official Excalidraw component to avoid SSR window issues
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-semibold">Loading Official Excalidraw Canvas...</span>
      </div>
    ),
  }
);

interface ExcalidrawBoardProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
  onSaveAsset: (name: string, content: string, scope?: 'shared' | 'private') => void;
  isViewer?: boolean;
}

export const ExcalidrawBoard: React.FC<ExcalidrawBoardProps> = ({
  user,
  company,
  websocket,
  onSaveAsset,
  isViewer = false,
}) => {
  const [workspaceScope, setWorkspaceScope] = useState<'shared' | 'private'>('shared');
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [boardName, setBoardName] = useState('Architecture & System Canvas');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const isUpdatingFromWs = useRef(false);

  const currentAssetId = workspaceScope === 'shared' 
    ? `excalidraw_${company.id}` 
    : `excalidraw_${company.id}_user_${user.id}`;

  // Initial load / scope switch: restore scene from IndexedDB or Cloudflare API
  useEffect(() => {
    if (!excalidrawAPI) return;

    (async () => {
      let initialData: any = null;

      // 1. Try restoring from IndexedDB offline store
      const offlineAsset = await getAssetOffline(currentAssetId);
      if (offlineAsset && offlineAsset.content) {
        try {
          initialData = JSON.parse(offlineAsset.content);
        } catch (e) {
          // ignore
        }
      }

      // 2. Try fetching from Cloudflare D1
      if (!initialData || !initialData.elements || initialData.elements.length === 0) {
        const token = localStorage.getItem('theysynced_token');
        if (token) {
          try {
            const res = await fetch(`/api/assets/list?token=${token}&company_id=${company.id}`);
            const data = await res.json();
            const excalidrawAsset = data.assets?.find((a: any) => a.id === currentAssetId);
            if (excalidrawAsset && excalidrawAsset.content) {
              initialData = JSON.parse(excalidrawAsset.content);
              if (excalidrawAsset.name) setBoardName(excalidrawAsset.name);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 3. If in private mode and empty, start fresh canvas; if shared, fall back to defaultDrawing
      if (!initialData || !initialData.elements || initialData.elements.length === 0) {
        initialData = workspaceScope === 'shared' ? defaultDrawing : { elements: [], appState: {} };
        if (workspaceScope === 'private') {
          setBoardName('My Private Canvas');
        } else {
          setBoardName('Architecture & System Canvas');
        }
      }

      // Render the selected scene data
      if (initialData && initialData.elements) {
        excalidrawAPI.updateScene({
          elements: initialData.elements,
          appState: initialData.appState || {},
        });
      }
    })();
  }, [excalidrawAPI, company.id, workspaceScope, user.id]);

  // Listen for WebSocket scene updates from co-workers (shared mode only)
  useEffect(() => {
    if (!websocket || !excalidrawAPI || workspaceScope !== 'shared') return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init' && data.state && data.state.drawing_elements) {
          isUpdatingFromWs.current = true;
          excalidrawAPI.updateScene({
            elements: data.state.drawing_elements,
            appState: data.state.drawing_app_state || {},
          });
          setTimeout(() => {
            isUpdatingFromWs.current = false;
          }, 100);
        } else if (data.type === 'whiteboard_update' && data.elements && data.user_id !== user.id) {
          isUpdatingFromWs.current = true;
          excalidrawAPI.updateScene({
            elements: data.elements,
            appState: data.app_state || {},
          });
          setTimeout(() => {
            isUpdatingFromWs.current = false;
          }, 100);
        }
      } catch (err) {
        // ignore malformed messages
      }
    };

    websocket.addEventListener('message', handleMessage);
    return () => {
      websocket.removeEventListener('message', handleMessage);
    };
  }, [websocket, excalidrawAPI, user.id, workspaceScope]);

  // Handle local user drawing changes
  const lastSyncTimeRef = useRef(0);
  const handleChange = (elements: readonly any[], appState: any) => {
    if (isUpdatingFromWs.current) return;

    const now = Date.now();
    if (now - lastSyncTimeRef.current > 300) {
      lastSyncTimeRef.current = now;

      // Broadcast over WebSocket only in shared mode
      if (workspaceScope === 'shared' && websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(
          JSON.stringify({
            type: 'whiteboard_update',
            elements: elements,
            app_state: {
              viewBackgroundColor: appState.viewBackgroundColor,
            },
          })
        );
      }

      // Save to IndexedDB offline store
      const sceneJson = JSON.stringify({
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
      });
      saveAssetOffline({
        id: currentAssetId,
        company_id: company.id,
        title: boardName,
        asset_type: 'excalidraw',
        content: sceneJson,
      });

      // Background persist to Cloudflare D1
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
              name: boardName,
              asset_type: 'whiteboard',
              content: sceneJson,
              created_by: user.username,
              updated_at: new Date().toISOString(),
              scope: workspaceScope,
            }
          }),
        }).catch(() => {});
      }
    }
  };

  const handleManualSave = async () => {
    if (!excalidrawAPI) return;
    setSaveStatus('saving');

    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();
    const content = JSON.stringify({
      elements,
      appState: { viewBackgroundColor: appState.viewBackgroundColor },
    });

    await saveAssetOffline({
      id: currentAssetId,
      company_id: company.id,
      title: boardName,
      asset_type: 'excalidraw',
      content,
    });

    const token = localStorage.getItem('theysynced_token');
    if (token) {
      await fetch('/api/assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          company_id: company.id,
          asset: {
            id: currentAssetId,
            company_id: company.id,
            name: boardName,
            asset_type: 'whiteboard',
            content,
            created_by: user.username,
            updated_at: new Date().toISOString(),
            scope: workspaceScope,
          }
        }),
      }).catch(() => {});
    }

    onSaveAsset(boardName, content, workspaceScope);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden relative">
      
      {/* Excalidraw Custom Control Header */}
      <div className="px-6 py-3 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between bg-white z-10 gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">
            <PenTool className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <input
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              className="text-sm font-bold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-indigo-600 focus:outline-none bg-transparent w-full"
            />
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
              <HardDrive className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>Official Excalidraw Canvas • Vector Collaboration</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          
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
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold">
              <Eye className="w-3.5 h-3.5" />
              <span>View Only</span>
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              className="px-4 py-2 bg-slate-950 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              {saveStatus === 'saved' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Saved</span>
                </>
              ) : saveStatus === 'saving' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Canvas</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Official Excalidraw Component Container */}
      <div className="flex-1 w-full h-full relative">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={isViewer ? undefined : handleChange}
          viewModeEnabled={isViewer}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: !isViewer,
              clearCanvas: !isViewer,
              export: { saveFileToDisk: true },
              loadScene: !isViewer,
              toggleTheme: true,
            },
          }}
        />
      </div>

    </div>
  );
};
