import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { UserAuth } from "@/components/UserAuth";
import { Toaster } from "react-hot-toast";
import { auth } from "@/auth";
import { HelpDrawer } from "./components/HelpDrawer";
import { prisma } from "@/lib/db";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

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
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const userRole = (session?.user as any)?.role || "EMPLOYEE";

  const isAdmin = userRole === "ADMIN";
  const isManager = userRole === "MANAGER";

  let pendingCount = 0;
  if (session?.user?.id && (isAdmin || isManager)) {
    pendingCount = await prisma.leaveRequest.count({
      where: {
        approverId: session.user.id,
        status: "PENDING"
      }
    });
  }

  return (
    <html lang="zh-TW" className={`${geistSans.variable} ${geistMono.variable} antialiased h-full bg-gray-50`} data-theme="light">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <Toaster 
          position="top-right" 
          toastOptions={{
            duration: 5000,
            className: '!bg-gray-900/80 !text-white !backdrop-blur-md',
          }}
        />
        <Providers>
          <ImpersonationBanner />
          <header className="bg-[var(--brand-primary)] text-white shadow-md sticky top-0 z-30">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <a href="/" className="font-bold text-xl tracking-tight">Timeoff</a>
                <nav className="hidden md:flex space-x-1">
                  <a href="/gantt" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">團隊甘特圖</a>
                  <a href="/settings" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">個人設定</a>

                  {(isAdmin || isManager) && (
                    <>
                      <a href="/admin/approvals" className="indicator px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">
                        審核
                        {pendingCount > 0 && (
                          <span className="indicator-item badge badge-secondary badge-xs bg-red-500 border-red-500"></span>
                        )}
                      </a>
                    </>
                  )}

                  {isAdmin && (
                    <>
                      <a href="/admin/users" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">員工管理</a>
                      <a href="/admin/departments" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">部門管理</a>
                      <a href="/admin/leave-settings" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">假別設定</a>
                      <a href="/admin/reports" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">報表</a>
                      <a href="/admin/qa" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">QA 編輯</a>
                      <a href="/admin/audit" className="px-3 py-2 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition">稽核日誌</a>
                    </>
                  )}
                </nav>
                <details className="md:hidden relative ml-2">
                  <summary className="cursor-pointer list-none p-2 -m-2 rounded hover:bg-white/10 transition" aria-label="開啟選單">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                  </summary>
                  <ul className="absolute left-0 mt-2 w-48 bg-[var(--brand-primary)] rounded-md shadow-xl z-50 py-2 border border-white/10 text-sm">
                    <li><a href="/gantt" className="block px-4 py-2 text-white/90 hover:bg-white/10">團隊甘特圖</a></li>
                    <li><a href="/settings" className="block px-4 py-2 text-white/90 hover:bg-white/10">個人設定</a></li>
                    {(isAdmin || isManager) && (
                      <>
                        <li>
                          <a href="/admin/approvals" className="block px-4 py-2 text-white/90 hover:bg-white/10">
                            審核 {pendingCount > 0 && <span className="ml-2 inline-block w-2 h-2 bg-red-500 rounded-full align-middle" />}
                          </a>
                        </li>
                      </>
                    )}
                    {isAdmin && (
                      <>
                        <li><a href="/admin/users" className="block px-4 py-2 text-white/90 hover:bg-white/10">員工管理</a></li>
                        <li><a href="/admin/departments" className="block px-4 py-2 text-white/90 hover:bg-white/10">部門管理</a></li>
                        <li><a href="/admin/leave-settings" className="block px-4 py-2 text-white/90 hover:bg-white/10">假別設定</a></li>
                        <li><a href="/admin/reports" className="block px-4 py-2 text-white/90 hover:bg-white/10">報表</a></li>
                        <li><a href="/admin/qa" className="block px-4 py-2 text-white/90 hover:bg-white/10">QA 編輯</a></li>
                        <li><a href="/admin/audit" className="block px-4 py-2 text-white/90 hover:bg-white/10">稽核日誌</a></li>
                      </>
                    )}
                  </ul>
                </details>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <HelpDrawer />
                <div className="h-6 w-px bg-white/20 mx-1 hidden sm:block" />
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
