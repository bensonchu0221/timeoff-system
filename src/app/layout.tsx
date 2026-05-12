import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { UserAuth } from "@/components/UserAuth";
import { Toaster } from "react-hot-toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Time Off System",
  description: "Internal Time Off Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <Toaster 
          position="top-right" 
          toastOptions={{
            duration: 5000,
            className: '!bg-gray-900/80 !text-white !backdrop-blur-md',
          }}
        />
        <Providers>
          <header className="bg-[var(--brand-primary)] text-white shadow-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <a href="/" className="font-bold text-xl tracking-tight">Timeoff</a>
                <nav className="hidden sm:flex space-x-4">
                  <a href="/" className="text-white/80 hover:text-white transition">首頁</a>
                  <a href="/apply" className="text-white/80 hover:text-white transition">請假</a>
                  <a href="/admin/approvals" className="text-white/80 hover:text-white transition">審核</a>
                  <a href="/admin/gantt" className="text-white/80 hover:text-white transition">團隊甘特圖</a>
                  <a href="/admin/users" className="text-white/80 hover:text-white transition">員工管理</a>
                  <a href="/admin/leave-settings" className="text-white/80 hover:text-white transition">假別設定</a>
                  <a href="/admin/reports" className="text-white/80 hover:text-white transition">報表</a>
                </nav>
              </div>
              <div className="flex items-center gap-4">
                <UserAuth />
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
