'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Company, UserProfile } from '../types';
import { Download, Save, RefreshCw, Check, HardDrive, PenTool, Eye } from 'lucide-react';

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
  onSaveAsset: (name: string, content: string) => void;
  isViewer?: boolean;
}

export const ExcalidrawBoard: React.FC<ExcalidrawBoardProps> = ({
  user,
  company,
  websocket,
  onSaveAsset,
  isViewer = false,
}) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [boardName, setBoardName] = useState('Architecture & System Canvas');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const isUpdatingFromWs = useRef(false);

  // Initial load: restore scene from IndexedDB offline store, database list, or default drawing fallback
  useEffect(() => {
    if (!excalidrawAPI) return;

    (async () => {
      let initialData: any = null;

      // 1. Try restoring from IndexedDB offline store
      const offlineAsset = await getAssetOffline(`excalidraw_${company.id}`);
      if (offlineAsset && offlineAsset.content) {
        try {
          initialData = JSON.parse(offlineAsset.content);
        } catch (e) {
          // ignore
        }
      }

      // 2. If empty, try fetching from the Rust Backend DB
      if (!initialData || !initialData.elements || initialData.elements.length === 0) {
        const token = localStorage.getItem('theysynced_token');
        if (token) {
          try {
            const res = await fetch(`/api/assets/list?token=${token}&company_id=${company.id}`);
            const data = await res.json();
            const excalidrawAsset = data.assets?.find((a: any) => a.id === `excalidraw_${company.id}`);
            if (excalidrawAsset && excalidrawAsset.content) {
              initialData = JSON.parse(excalidrawAsset.content);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 3. If still empty, fall back to our user-provided default drawing JSON
      if (!initialData || !initialData.elements || initialData.elements.length === 0) {
        initialData = defaultDrawing;
      }

      // Render the selected scene data
      if (initialData && initialData.elements) {
        excalidrawAPI.updateScene({
          elements: initialData.elements,
          appState: initialData.appState || {},
        });
      }
    })();
  }, [excalidrawAPI, company.id]);

  // Listen for WebSocket scene updates from co-workers
  useEffect(() => {
    if (!websocket || !excalidrawAPI) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'excalidraw_elements' && data.user_id !== user.id && data.elements) {
          isUpdatingFromWs.current = true;
          excalidrawAPI.updateScene({ elements: data.elements });
          setTimeout(() => {
            isUpdatingFromWs.current = false;
          }, 300);
        }
      } catch (e) {
        // ignore
      }
    };

    websocket.addEventListener('message', handleMessage);
    return () => websocket.removeEventListener('message', handleMessage);
  }, [websocket, excalidrawAPI, user.id]);

  // Sync scene changes to WebSockets & Save Offline
  const handleChange = (elements: readonly any[], appState: any) => {
    if (isUpdatingFromWs.current) return;

    // Throttle WebSocket broadcast
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          type: 'excalidraw_elements',
          elements,
        })
      );
    }

    // Auto Save Offline IndexedDB
    saveAssetOffline({
      id: `excalidraw_${company.id}`,
      company_id: company.id,
      title: boardName,
      asset_type: 'excalidraw',
      content: JSON.stringify({ elements, appState: { theme: appState.theme } }),
    });

    // Auto Save to Rust Backend DB
    const token = localStorage.getItem('theysynced_token');
    if (token) {
      fetch('/api/assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          company_id: company.id,
          asset: {
            id: `excalidraw_${company.id}`,
            company_id: company.id,
            name: boardName,
            asset_type: 'whiteboard',
            content: JSON.stringify({ elements, appState: { theme: appState.theme } }),
            created_by: user.username,
            updated_at: new Date().toISOString(),
          }
        }),
      }).catch(() => {});
    }
  };

  const handleManualSave = async () => {
    if (!excalidrawAPI) return;
    setSaveStatus('saving');
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();
    const content = JSON.stringify({ elements, appState });

    await saveAssetOffline({
      id: `excalidraw_${company.id}`,
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
            id: `excalidraw_${company.id}`,
            company_id: company.id,
            name: boardName,
            asset_type: 'whiteboard',
            content,
            created_by: user.username,
            updated_at: new Date().toISOString(),
          }
        }),
      }).catch(() => {});
    }

    onSaveAsset(boardName, content);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };


  return (
    <div className="h-full flex flex-col bg-white overflow-hidden relative">
      
      {/* Excalidraw Custom Control Header */}
      <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-white z-10">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">
            <PenTool className="w-4 h-4" />
          </div>

          <div>
            <input
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              className="text-sm font-bold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-indigo-600 focus:outline-none bg-transparent"
            />
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-emerald-500" />
              <span>Official Excalidraw Engine • Realtime & IndexedDB Offline Sync</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {isViewer ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-xs font-bold">
              <Eye className="w-3.5 h-3.5" />
              View Only
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              className="px-4 py-2 bg-slate-900 text-white rounded-full text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-1.5 shadow-sm"
            >
              {saveStatus === 'saved' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Saved Offline</span>
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
