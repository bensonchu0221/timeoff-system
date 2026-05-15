import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"

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
      }
      return session;
    },
  },
})
