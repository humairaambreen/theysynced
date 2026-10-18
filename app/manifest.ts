import { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TheySynced Office Platform',
    short_name: 'TheySynced',
    description: 'Realtime collaborative office platform with Excalidraw whiteboards, Excel spreadsheets, Notion docs, and WebRTC HD meetings.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F8F9FB',
    theme_color: '#E0E3FF',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  };
}
