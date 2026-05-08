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
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const email = user.email || profile?.email;
        if (!email) return false;
        
        // 網域白名單檢查
        if (email.endsWith("@popin.cc") || email.endsWith("@broadciel.com")) {
          return true;
        }
        
        // 拒絕非白名單網域登入
        return false;
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
