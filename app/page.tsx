'use client';

import dynamic from 'next/dynamic';

const App = dynamic(() => import('../src_frontend/App'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Loading TheySynced Office...</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return <App />;
}
