import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  themeColor: '#dc2626',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'YouTube Transcript Bulk Exporter',
  description: 'Extract, process, and export transcripts from entire YouTube channels in bulk. Features AI fallback for missing captions using Gemini.',
  applicationName: 'YT Bulk Exporter',
  manifest: '/manifest.json',
  openGraph: {
    title: 'YouTube Transcript Bulk Exporter',
    description: 'Extract, process, and export transcripts from entire YouTube channels in bulk. Features AI fallback for missing captions.',
    url: 'https://github.com/yourusername/youtube-transcript-bulk-exporter',
    siteName: 'YT Bulk Exporter',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YouTube Transcript Bulk Exporter',
    description: 'Extract, process, and export transcripts from entire YouTube channels in bulk.',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                  }, function(err) {
                    console.log('ServiceWorker registration failed: ', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
