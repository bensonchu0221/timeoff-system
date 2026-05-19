import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import { readImpersonationCookies } from "@/lib/impersonation"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const rawEmail = user.email || profile?.email;
        if (!rawEmail) return false;
        const email = rawEmail.toLowerCase().trim();

        // 先檢查網域白名單
        if (!email.endsWith("@popin.cc") && !email.endsWith("@broadciel.com")) {
          return "/unauthorized"
        }

        // 檢查資料庫是否已經有這個員工
        const dbUser = await prisma.user.findUnique({
          where: { email: email }
        })

        if (!dbUser) {
          // 如果沒有在系統中建檔，拒絕登入並導向未授權頁面
          return "/unauthorized"
        }

        // 離職員工不可再登入系統
        if (dbUser.terminatedDate) {
          return "/unauthorized"
        }

        return true;
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        // In Auth.js with database sessions, `user` object passed here contains the DB model
        // So we can pass role from DB to session
        if ('role' in user) {
          (session.user as any).role = user.role;
        }

        // Impersonation：若實際身分為 ADMIN 且有有效 impersonate cookie，
        // 把 session.user 換成被檢視員工的資料；同時保留 realActor 與 impersonating 旗標
        // 用途：admin 想以員工視角檢視畫面（例如確認 BalanceSummary / 假單）
        if ((user as any).role === "ADMIN") {
          const { targetUserId, actorUserId } = await readImpersonationCookies()
          // actor cookie 必須等於目前真實 admin id，否則代表 cookie 過期或被冒用，忽略
          if (targetUserId && actorUserId === user.id) {
            const target = await prisma.user.findUnique({
              where: { id: targetUserId },
              select: { id: true, name: true, chineseName: true, email: true, image: true, role: true },
            })
            if (target) {
              const realActor = {
                id: user.id,
                name: (user as any).name ?? null,
                email: (user as any).email ?? null,
              }
              session.user.id = target.id
              session.user.name = target.name
              session.user.email = target.email
              session.user.image = target.image ?? null
              ;(session.user as any).role = target.role
              ;(session.user as any).chineseName = target.chineseName ?? null
              ;(session as any).impersonating = true
              ;(session as any).realActor = realActor
            }
          }
        }
      }
      return session;
    },
  },
})
