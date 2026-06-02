import './globals.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning className="h-full">
      <body suppressHydrationWarning className="h-full flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
