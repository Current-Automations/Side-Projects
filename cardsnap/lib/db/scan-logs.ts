/**
 * lib/db/scan-logs.ts
 *
 * Scan log helpers — every scan gets a record, corrections update it.
 * Ownership is always verified before any mutation.
 */
import { getServerClient } from './server-client'
import { InsertScanLogSchema } from '../types/db'
import type { ScanLog, InsertScanLog, DbResult } from '../types/db'

export async function createScanLog(input: InsertScanLog): Promise<DbResult<ScanLog>> {
  try {
    const validated = InsertScanLogSchema.parse(input)
    const db = getServerClient()

    const { data, error } = await db
      .from('scan_logs')
      .insert(validated)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as ScanLog }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Marks a scan as corrected.
 * Verifies that the scan belongs to the requesting user before writing.
 */
export async function markScanCorrected(params: {
  scanLogId:        string
  userId:           string
  correctionSource: string
}): Promise<DbResult<ScanLog>> {
  try {
    const db = getServerClient()

    // Ownership check
    const { data: existing, error: fetchError } = await db
      .from('scan_logs')
      .select('id, user_id')
      .eq('id', params.scanLogId)
      .single()

    if (fetchError)              return { success: false, error: fetchError.message }
    if (!existing)               return { success: false, error: 'Scan log not found' }
    if (existing.user_id !== params.userId) return { success: false, error: 'Unauthorized' }

    const { data, error } = await db
      .from('scan_logs')
      .update({
        was_corrected:     true,
        correction_source: params.correctionSource,
      })
      .eq('id', params.scanLogId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as ScanLog }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getRecentScans(userId: string, limit = 20): Promise<DbResult<ScanLog[]>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('scan_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as ScanLog[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Paginated scan history — cursor-based via `before` timestamp. */
export async function getScanHistory(params: {
  userId: string
  limit?:  number
  before?: string // ISO timestamp cursor
}): Promise<DbResult<ScanLog[]>> {
  try {
    const db = getServerClient()
    const limit = params.limit ?? 50

    let query = db
      .from('scan_logs')
      .select('*')
      .eq('user_id', params.userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (params.before) {
      query = query.lt('created_at', params.before)
    }

    const { data, error } = await query

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as ScanLog[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
