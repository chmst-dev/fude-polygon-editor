import './globals.css';
export const metadata = {
  title: '共同編集システム',
  description: '圃場ポリゴン共同編集システム',
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
