import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TheySynced — Enterprise Office & Collaboration Platform',
  description: 'Realtime office platform with Excalidraw, Excel spreadsheets, Notion docs, WebRTC video calls, and Apple UI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@300,301,400,401,500,501,700,701,900,901&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#F8F9FB] text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
