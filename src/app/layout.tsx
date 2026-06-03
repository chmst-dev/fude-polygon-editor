import './globals.css';
export const metadata = {
  title: 'みんなの圃場マップ共同編集画面',
  description: '圃場情報を入れる画面です',
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
