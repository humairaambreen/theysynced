'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Company, UserProfile, WorkspaceAsset } from '../types';
import { Table, Download, Plus, Save, Check, HardDrive, Trash2, Search, Eye, Globe, Lock } from 'lucide-react';
import { saveAssetOffline, getAssetOffline } from '../lib/offlineStore';

interface SpreadsheetViewProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
  onSaveAsset: (name: string, content: string, scope?: 'shared' | 'private') => void;
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
  const [workspaceScope, setWorkspaceScope] = useState<'shared' | 'private'>('shared');
  const [sheetName, setSheetName] = useState('Enterprise Financial Sheet');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [searchQuery, setSearchQuery] = useState('');

  const currentAssetId = workspaceScope === 'shared' 
    ? `spreadsheet_${company.id}` 
    : `spreadsheet_${company.id}_user_${user.id}`;

  const defaultData = [
    ['Teammate', 'Q1 Target', 'Q2 Target', 'Q3 Target', 'Annual Target'],
    ['Aryan Rao', '12000', '14000', '18000', '44000'],
    ['Teammate B', '8500', '9400', '12400', '30300'],
    ['Teammate C', '10000', '15000', '19000', '44000'],
    ['Total Revenue', '30500', '38400', '49400', '118300'],
  ];

  const [gridData, setGridData] = useState<string[][]>(defaultData);

  // Mount/load sheet when scope changes or component mounts
  useEffect(() => {
    (async () => {
      const onlineAsset = assets.find((a) => a.id === currentAssetId);
      if (onlineAsset && onlineAsset.content) {
        try {
          const parsed = JSON.parse(onlineAsset.content);
          if (Array.isArray(parsed.data) && parsed.data.length > 0) {
            setGridData(parsed.data);
          }
          if (parsed.title) {
            setSheetName(parsed.title);
          }
          await saveAssetOffline({
            id: currentAssetId,
            company_id: company.id,
            title: parsed.title || sheetName,
            asset_type: 'spreadsheet',
            content: onlineAsset.content,
          });
        } catch (_) {}
      } else {
        const offline = await getAssetOffline(currentAssetId);
        if (offline && offline.content) {
          try {
            const parsed = JSON.parse(offline.content);
            if (Array.isArray(parsed.data) && parsed.data.length > 0) {
              setGridData(parsed.data);
            }
            if (parsed.title) {
              setSheetName(parsed.title);
            }
          } catch (_) {}
        } else {
          if (workspaceScope === 'private') {
            setGridData([
              ['Task / Item', 'Category', 'Estimate ($)', 'Status'],
              ['Personal Goal 1', 'Development', '2000', 'In Progress'],
              ['Learning Budget', 'Education', '1500', 'Planned'],
            ]);
            setSheetName('My Private Sheet');
          } else {
            setGridData(defaultData);
            setSheetName('Enterprise Financial Sheet');
          }
        }
      }
    })();
  }, [company.id, workspaceScope, user.id]);

  // WebSocket sync for shared spreadsheets
  useEffect(() => {
    if (!websocket || workspaceScope !== 'shared') return;

    const handleWs = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'init' && data.state && data.state.spreadsheet_data) {
          setGridData(data.state.spreadsheet_data);
        } else if (data.type === 'sheet_cell_update' && data.user_id !== user.id) {
          setGridData((prev) => {
            const copy = prev.map((row) => [...row]);
            if (copy[data.row] && copy[data.row][data.col] !== undefined) {
              copy[data.row][data.col] = data.val;
            }
            return copy;
          });
        }
      } catch (_) {}
    };

    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, user.id, workspaceScope]);

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    if (isViewer) return;
    const updated = gridData.map((row, rIdx) => {
      if (rIdx === rowIndex) {
        const newRow = [...row];
        newRow[colIndex] = value;
        return newRow;
      }
      return row;
    });
    setGridData(updated);

    // Broadcast cell update over WebSocket if in shared mode
    if (workspaceScope === 'shared' && websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          type: 'sheet_cell_update',
          row: rowIndex,
          col: colIndex,
          val: value,
        })
      );
    }

    saveOffline(updated);
  };

  const handleAddRow = () => {
    if (isViewer) return;
    const colCount = gridData[0] ? gridData[0].length : 5;
    const newRow = new Array(colCount).fill('');
    const updated = [...gridData, newRow];
    setGridData(updated);
    saveOffline(updated);
  };

  const handleAddCol = () => {
    if (isViewer) return;
    const updated = gridData.map((row, idx) => [
      ...row,
      idx === 0 ? `Col ${row.length + 1}` : '',
    ]);
    setGridData(updated);
    saveOffline(updated);
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (isViewer || gridData.length <= 1) return;
    const updated = gridData.filter((_, idx) => idx !== rowIndex);
    setGridData(updated);
    saveOffline(updated);
  };

  const handleDeleteCol = (colIndex: number) => {
    if (isViewer || gridData[0]?.length <= 1) return;
    const updated = gridData.map((row) => row.filter((_, idx) => idx !== colIndex));
    setGridData(updated);
    saveOffline(updated);
  };

  const saveOffline = (updatedData: string[][]) => {
    const content = JSON.stringify({ data: updatedData, title: sheetName });
    saveAssetOffline({
      id: currentAssetId,
      company_id: company.id,
      title: sheetName,
      asset_type: 'spreadsheet',
      content,
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
            name: sheetName,
            asset_type: 'spreadsheet',
            content,
            created_by: user.username,
            updated_at: new Date().toISOString(),
            scope: workspaceScope,
          }
        }),
      }).catch(() => {});
    }
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
      id: currentAssetId,
      company_id: company.id,
      title: sheetName,
      asset_type: 'spreadsheet',
      content,
    });
    onSaveAsset(sheetName, content, workspaceScope);
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
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
              <HardDrive className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>Enterprise Financial Grid • Real-time Offline Cache</span>
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

          <div className="relative mr-1 shrink-0">
            <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Filter cells..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-600 w-28 sm:w-36"
            />
          </div>

          {!isViewer && (
            <>
              <button
                onClick={handleAddRow}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Row</span>
              </button>
              <button
                onClick={handleAddCol}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Col</span>
              </button>
            </>
          )}

          <button
            onClick={handleExportCsv}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-1 transition-all shrink-0"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>

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
                  <span>Save Sheet</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6 bg-slate-100/50">
        <div className="inline-block min-w-full align-middle bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="w-12 px-3 py-2.5 text-center border-r border-slate-200 bg-slate-100/60">#</th>
                {gridData[0] &&
                  gridData[0].map((_, colIdx) => (
                    <th key={colIdx} className="px-4 py-2.5 border-r border-slate-200 group relative">
                      <div className="flex items-center justify-between">
                        <span>{String.fromCharCode(65 + (colIdx % 26))}</span>
                        {!isViewer && gridData[0].length > 1 && (
                          <button
                            onClick={() => handleDeleteCol(colIdx)}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 p-0.5 rounded transition-all ml-1"
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
              {gridData.map((row, rowIdx) => {
                const isMatch = searchQuery
                  ? row.some((cell) => cell.toLowerCase().includes(searchQuery.toLowerCase()))
                  : true;

                if (!isMatch) return null;

                const isHeader = rowIdx === 0;

                return (
                  <tr
                    key={rowIdx}
                    className={`border-b border-slate-200 transition-colors ${
                      isHeader ? 'bg-slate-50/70 font-bold' : 'hover:bg-indigo-50/20'
                    }`}
                  >
                    <td className="px-3 py-1.5 text-center text-xs font-mono text-slate-400 border-r border-slate-200 bg-slate-50 select-none group relative">
                      <span>{rowIdx + 1}</span>
                      {!isViewer && gridData.length > 1 && (
                        <button
                          onClick={() => handleDeleteRow(rowIdx)}
                          className="opacity-0 group-hover:opacity-100 absolute left-1 top-2 text-slate-400 hover:text-rose-600 transition-all"
                          title="Delete Row"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </td>

                    {row.map((cellValue, colIdx) => (
                      <td key={colIdx} className="border-r border-slate-200 p-0 min-w-[120px]">
                        <input
                          type="text"
                          disabled={isViewer}
                          value={cellValue}
                          onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                          className={`w-full px-3 py-2 text-xs text-slate-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:bg-white transition-all ${
                            isHeader ? 'font-bold text-slate-900' : ''
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
