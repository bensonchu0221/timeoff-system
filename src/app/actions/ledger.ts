"use server"

import { auth } from "@/auth"
import { getLeaveLedger, LedgerEvent } from "@/lib/ledger-utils"
import { prisma } from "@/lib/db"

export async function fetchUserLeaveLedger(leaveTypeId: string): Promise<{ success: boolean, data?: LedgerEvent[], hireDate?: Date, error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: "Unauthorized" }

  try {
    const data = await getLeaveLedger(session.user.id, leaveTypeId)
    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    return { success: true, data, hireDate: user?.hireDate || user?.createdAt }
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to fetch ledger" }
  }
}
