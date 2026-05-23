/**
 * lib/types/training.ts
 *
 * Zod schemas and inferred types for the active-learning training pipeline.
 * These types mirror the training_examples and training_runs DB tables.
 */

import { z } from 'zod';
import { CardIdentificationSchema } from './domain';

// ---------------------------------------------------------------------------
// Training example — a labelled image used in fine-tuning
// ---------------------------------------------------------------------------

export const TrainingExampleSchema = z.object({
  id: z.string().uuid(),
  image_hash: z.string().min(1),
  correct_labels: CardIdentificationSchema,
  source: z.enum(['user_correction', 'confirmed', 'bootstrap']),
  training_set_id: z.string().uuid().optional(),
  generation: z.number().int().min(0),
  created_at: z.string(),
});

export type TrainingExample = z.infer<typeof TrainingExampleSchema>;

// ---------------------------------------------------------------------------
// Training run — a single OpenAI fine-tuning job
// ---------------------------------------------------------------------------

export const TrainingRunSchema = z.object({
  id: z.string().uuid(),
  openai_job_id: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']), // maps to training_runs.status CHECK constraint
  model_id: z.string().optional(),
  generation: z.number().int().min(0),
  example_count: z.number().int().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  is_active: z.boolean(),
});

export type TrainingRun = z.infer<typeof TrainingRunSchema>;
