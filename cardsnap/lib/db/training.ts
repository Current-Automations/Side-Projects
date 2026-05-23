/**
 * lib/db/training.ts
 *
 * Active learning pipeline helpers.
 *
 * Flow:
 *   user correction → insertTrainingExample()
 *   ~200 untrained examples → trigger fine-tuning job
 *   job completes → activateTrainingRun()
 *   new generation → pruneOldGenerations()  (keeps N, N-1, N-2)
 */
import { getServerClient } from './server-client'
import { InsertTrainingExampleSchema } from '../types/db'
import type { InsertTrainingExample, DbResult } from '../types/db'
import type { TrainingExample, TrainingRun } from '../types/training'

// Number of untrained examples needed before triggering a training run
export const TRAINING_TRIGGER_THRESHOLD = 200

// How many generations to keep (N, N-1, N-2 = 3 total)
const GENERATIONS_TO_KEEP = 3

export async function insertTrainingExample(
  input: InsertTrainingExample
): Promise<DbResult<TrainingExample>> {
  try {
    const validated = InsertTrainingExampleSchema.parse(input)
    const db = getServerClient()

    const { data, error } = await db
      .from('training_examples')
      .insert(validated)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as TrainingExample }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** All examples not yet used in a training run, for a given generation. */
export async function getUntrainedExamples(
  generation: number
): Promise<DbResult<TrainingExample[]>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('training_examples')
      .select('*')
      .eq('generation', generation)
      .is('trained_at', null)

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as TrainingExample[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Count of all untrained examples (any generation). */
export async function getUntrainedExampleCount(): Promise<DbResult<number>> {
  try {
    const db = getServerClient()

    const { count, error } = await db
      .from('training_examples')
      .select('*', { count: 'exact', head: true })
      .is('trained_at', null)

    if (error) return { success: false, error: error.message }
    return { success: true, data: count ?? 0 }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Returns the currently active (deployed) fine-tuned model run.
 * Returns null if we're still on base GPT-4o.
 */
export async function getActiveTrainingRun(): Promise<DbResult<TrainingRun | null>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('training_runs')
      .select('*')
      .eq('is_active', true)
      .eq('status', 'succeeded')
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as TrainingRun | null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function insertTrainingRun(params: {
  openai_job_id: string
  generation:    number
  example_count: number
}): Promise<DbResult<TrainingRun>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('training_runs')
      .insert({
        openai_job_id: params.openai_job_id,
        generation:    params.generation,
        example_count: params.example_count,
        status:        'running',
        is_active:     false,
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as TrainingRun }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Marks a completed fine-tuning run as active.
 * Deactivates all previous runs atomically.
 */
export async function activateTrainingRun(
  runId:   string,
  modelId: string
): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()

    // Deactivate everything else first
    const { error: deactivateError } = await db
      .from('training_runs')
      .update({ is_active: false })
      .neq('id', runId)

    if (deactivateError) return { success: false, error: deactivateError.message }

    // Activate this run
    const { error } = await db
      .from('training_runs')
      .update({
        is_active:    true,
        status:       'succeeded',
        model_id:     modelId,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * 3-generation pruning rule.
 * Keeps generations N, N-1, N-2. Deletes examples + run records for N-3 and older.
 * The caller is responsible for deleting the OpenAI model via the OpenAI API
 * before calling this (so the model_id is still available for that call).
 */
export async function pruneOldGenerations(
  currentGeneration: number
): Promise<DbResult<{ deletedExamples: number; deletedRuns: number }>> {
  try {
    if (currentGeneration < GENERATIONS_TO_KEEP) {
      return { success: true, data: { deletedExamples: 0, deletedRuns: 0 } }
    }

    const pruneBeforeGeneration = currentGeneration - GENERATIONS_TO_KEEP + 1
    const db = getServerClient()

    const { count: deletedExamples, error: exampleError } = await db
      .from('training_examples')
      .delete({ count: 'exact' })
      .lt('generation', pruneBeforeGeneration)

    if (exampleError) return { success: false, error: exampleError.message }

    const { count: deletedRuns, error: runError } = await db
      .from('training_runs')
      .delete({ count: 'exact' })
      .lt('generation', pruneBeforeGeneration)

    if (runError) return { success: false, error: runError.message }

    return {
      success: true,
      data: { deletedExamples: deletedExamples ?? 0, deletedRuns: deletedRuns ?? 0 },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─────────────────────────────────────────────
// ALIASES — match names expected by lib/db/index.ts
// ─────────────────────────────────────────────

/** Alias for insertTrainingRun — start a new OpenAI fine-tuning job record. */
export const createTrainingRun = insertTrainingRun

/** Update a training run's status, model_id, or completed_at. */
export async function updateTrainingRun(
  runId: string,
  updates: {
    status?:       'pending' | 'running' | 'completed' | 'failed'
    model_id?:     string
    completed_at?: string
    is_active?:    boolean
  }
): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()
    const { error } = await db
      .from('training_runs')
      .update(updates)
      .eq('id', runId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Mark a set of examples as used in a training run (set trained_at). */
export async function markExamplesTrained(
  exampleIds: string[],
  trainingSetId: string
): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()

    const { error } = await db
      .from('training_examples')
      .update({ trained_at: new Date().toISOString(), training_set_id: trainingSetId })
      .in('id', exampleIds)

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
