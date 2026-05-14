"use server"

import { auth } from "@/auth"
import { getLeaveLedger, LedgerEvent } from "@/lib/ledger-utils"

export async function fetchUserLeaveLedger(leaveTypeId: string): Promise<{ success: boolean, data?: LedgerEvent[], error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: "Unauthorized" }

  try {
    const data = await getLeaveLedger(session.user.id, leaveTypeId)
    return { success: true, data }
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to fetch ledger" }
  }
}
