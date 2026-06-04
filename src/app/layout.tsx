import './globals.css';
export const metadata = {
  title: 'みんなの圃場マップ',
  description: '圃場情報を入れる画面です',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning className="h-full">
      <body suppressHydrationWarning className="h-full flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
