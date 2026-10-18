'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Company, UserProfile, WorkspaceAsset } from '../types';
import { Table, Download, Plus, Save, Check, HardDrive, Trash2, Search, Eye } from 'lucide-react';
import { saveAssetOffline, getAssetOffline } from '../lib/offlineStore';

interface SpreadsheetViewProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
  onSaveAsset: (name: string, content: string) => void;
  assets: WorkspaceAsset[];
  isViewer?: boolean;
}

export const SpreadsheetView: React.FC<SpreadsheetViewProps> = ({
  user,
  company,
  websocket,
  onSaveAsset,
  assets,
  isViewer = false,
}) => {
  const [sheetName, setSheetName] = useState('Enterprise Financial Sheet');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [searchQuery, setSearchQuery] = useState('');

  const defaultData = [
    ['Teammate', 'Q1 Target', 'Q2 Target', 'Q3 Target', 'Annual Target'],
    ['Aryan Rao', '12000', '14000', '18000', '44000'],
    ['Teammate B', '8500', '9400', '12400', '30300'],
    ['Teammate C', '10000', '15000', '19000', '44000'],
    ['Total Revenue', '30500', '38400', '49400', '118300'],
  ];

  const [gridData, setGridData] = useState<string[][]>(defaultData);
  const hasLoadedRef = useRef<string | null>(null);

  // Mount/load sheet from online asset or local fallback
  useEffect(() => {
    if (hasLoadedRef.current === company.id) return;

    (async () => {
      const onlineAsset = assets.find((a) => a.id === `spreadsheet_${company.id}`);
      if (onlineAsset && onlineAsset.content) {
        try {
          const parsed = JSON.parse(onlineAsset.content);
          if (Array.isArray(parsed.data) && parsed.data.length > 0) {
            setGridData(parsed.data);
          }
          if (parsed.title) {
            setSheetName(parsed.title);
          }
          // Sync to offline store
          await saveAssetOffline({
            id: `spreadsheet_${company.id}`,
            company_id: company.id,
            title: parsed.title || sheetName,
            asset_type: 'spreadsheet',
            content: onlineAsset.content,
          });
          hasLoadedRef.current = company.id;
          return;
        } catch (e) {
          // ignore
        }
      }

      const offline = await getAssetOffline(`spreadsheet_${company.id}`);
      if (offline && offline.content) {
        try {
          const parsed = JSON.parse(offline.content);
          if (Array.isArray(parsed.data) && parsed.data.length > 0) {
            setGridData(parsed.data);
          }
          if (parsed.title) {
            setSheetName(parsed.title);
          }
          hasLoadedRef.current = company.id;
        } catch (e) {
          // ignore fallback
        }
      }
    })();
  }, [company.id, assets]);

  // Real-time WebSocket spreadsheet synchronization
  useEffect(() => {
    if (!websocket) return;

    const handleWs = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'init' && data.state && data.state.spreadsheet_grid && data.state.spreadsheet_grid.length > 0) {
          setGridData(data.state.spreadsheet_grid);
        } else if (data.type === 'sheet_update' && data.data && data.user_id !== user.id) {
          setGridData(data.data);
        }
      } catch (err) {
        // ignore
      }
    };

    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, user.id]);

  const handleCellChange = (rowIndex: number, colIndex: number, val: string) => {
    const updated = gridData.map((row, r) =>
      r === rowIndex
        ? row.map((cell, c) => (c === colIndex ? val : cell))
        : row
    );
    setGridData(updated);

    // Save to offlineStore
    const content = JSON.stringify({ data: updated, title: sheetName });
    saveAssetOffline({
      id: `spreadsheet_${company.id}`,
      company_id: company.id,
      title: sheetName,
      asset_type: 'spreadsheet',
      content,
    });

    // Sync over Websockets if available
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({
        type: 'sheet_update',
        company_id: company.id,
        data: updated,
      }));
    }
  };

  const handleAddRow = () => {
    const colCount = gridData[0]?.length || 5;
    const newRow = new Array(colCount).fill('');
    const updated = [...gridData, newRow];
    setGridData(updated);
    saveOffline(updated);
  };

  const handleAddCol = () => {
    const updated = gridData.map((row) => [...row, '']);
    setGridData(updated);
    saveOffline(updated);
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (gridData.length <= 1) return;
    const updated = gridData.filter((_, idx) => idx !== rowIndex);
    setGridData(updated);
    saveOffline(updated);
  };

  const handleDeleteCol = (colIndex: number) => {
    if (gridData[0]?.length <= 1) return;
    const updated = gridData.map((row) => row.filter((_, idx) => idx !== colIndex));
    setGridData(updated);
    saveOffline(updated);
  };

  const saveOffline = (updatedData: string[][]) => {
    const content = JSON.stringify({ data: updatedData, title: sheetName });
    saveAssetOffline({
      id: `spreadsheet_${company.id}`,
      company_id: company.id,
      title: sheetName,
      asset_type: 'spreadsheet',
      content,
    });
  };

  const handleExportCsv = () => {
    const csvContent = gridData.map((e) => e.map(val => `"${val.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${sheetName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleManualSave = async () => {
    setSaveStatus('saving');
    const content = JSON.stringify({ data: gridData, title: sheetName });
    await saveAssetOffline({
      id: `spreadsheet_${company.id}`,
      company_id: company.id,
      title: sheetName,
      asset_type: 'spreadsheet',
      content,
    });
    onSaveAsset(sheetName, content);
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
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
            <Table className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              className="text-sm font-bold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-emerald-600 focus:outline-none bg-transparent w-full"
            />
            <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
              <HardDrive className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="truncate">Enterprise Financial Grid • Real-time Offline Cache</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 w-full md:w-auto overflow-x-auto flex-nowrap pb-1 scrollbar-none shrink-0">
          {/* Row/Col Search bar */}
          <div className="relative mr-1 shrink-0">
            <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] sm:text-xs font-semibold focus:outline-none focus:border-indigo-600 bg-slate-50/50 w-24 sm:w-36"
            />
          </div>

          {!isViewer && (
            <>
              <button
                onClick={handleAddRow}
                className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
              >
                <Plus className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                <span className="hidden sm:inline">Add Row</span>
                <span className="sm:hidden">Row+</span>
              </button>

              <button
                onClick={handleAddCol}
                className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
              >
                <Plus className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                <span className="hidden sm:inline">Add Column</span>
                <span className="sm:hidden">Col+</span>
              </button>
            </>
          )}

          <button
            onClick={handleExportCsv}
            className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
          >
            <Download className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </button>

          {isViewer ? (
            <span className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-[10px] sm:text-xs font-bold shrink-0">
              <Eye className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              View Only
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              className="px-2 sm:px-4 py-1 sm:py-1.5 bg-slate-900 text-white rounded-full text-[10px] sm:text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-1 shadow-sm shrink-0"
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
                  <span className="hidden sm:inline">Save Sheet</span>
                  <span className="sm:hidden">Save</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 w-full overflow-auto p-6 flex flex-col">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-md overflow-hidden flex flex-col flex-1">
          <div className="overflow-auto flex-1">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="w-14 py-2.5 px-2 border-r border-slate-200 bg-slate-200/60 text-center">#</th>
                  {gridData[0]?.map((_, cIdx) => (
                    <th key={cIdx} className="py-2.5 px-4 border-r border-slate-200 text-left font-bold font-mono relative group">
                      <div className="flex items-center justify-between">
                        <span>{String.fromCharCode(65 + cIdx)}</span>
                        {!isViewer && gridData[0].length > 1 && (
                          <button
                            onClick={() => handleDeleteCol(cIdx)}
                            className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 transition-opacity"
                            title="Delete Column"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridData.map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors group">
                    <td className="py-2 px-2 border-r border-slate-200 bg-slate-100/60 font-mono text-[11px] text-slate-500 text-center font-bold">
                      <div className="flex items-center justify-center gap-1">
                        <span>{rIdx + 1}</span>
                        {!isViewer && gridData.length > 1 && (
                          <button
                            onClick={() => handleDeleteRow(rIdx)}
                            className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 transition-opacity shrink-0"
                            title="Delete Row"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {row.map((cellVal, cIdx) => {
                      const isMatch = searchQuery && cellVal.toLowerCase().includes(searchQuery.toLowerCase());
                      return (
                        <td key={cIdx} className={`border-r border-slate-200 p-0 transition-colors ${
                          isMatch ? 'bg-amber-50' : ''
                        }`}>
                          <input
                            type="text"
                            value={cellVal}
                            onChange={(e) => isViewer ? undefined : handleCellChange(rIdx, cIdx, e.target.value)}
                            readOnly={isViewer}
                            className={`w-full h-full px-3 py-2.5 text-xs text-slate-800 focus:outline-none font-medium ${
                              isViewer
                                ? 'cursor-default select-text'
                                : 'focus:bg-indigo-50/40 focus:ring-1 focus:ring-indigo-500/50'
                            } ${
                              isMatch ? 'bg-amber-100/70 font-bold text-amber-900' : 'bg-transparent'
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>


    </div>
  );
};
