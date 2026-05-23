/**
 * lib/db/schema.ts
 *
 * Raw database row types mirroring the Supabase PostgreSQL schema.
 * These are DB-layer types only — separate from domain types in lib/types/domain.ts.
 * Follow Supabase's generated type pattern so createClient<Database>() works.
 */

// ---------------------------------------------------------------------------
// Scalar union types derived from CHECK constraints
// ---------------------------------------------------------------------------

export type SportValue = 'NFL' | 'NBA' | 'MLB' | 'NHL';
export type GradeCompanyValue = 'PSA' | 'BGS' | 'SGC' | 'CGC';
export type PlanTierValue = 'free' | 'basic' | 'pro' | 'streamer';
export type TrainingSourceValue = 'user_correction' | 'confirmed' | 'bootstrap';
export type TrainingStatusValue = 'pending' | 'running' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------------

export interface CardRow {
  id: string;
  player_name: string;
  year: number;
  manufacturer: string;
  set_name: string;
  parallel: string;
  card_number: string | null;
  sport: SportValue;
  created_at: string;
}

export interface CardInsert {
  id?: string;
  player_name: string;
  year: number;
  manufacturer: string;
  set_name: string;
  parallel?: string;
  card_number?: string | null;
  sport: SportValue;
  created_at?: string;
}

export interface CardUpdate {
  id?: string;
  player_name?: string;
  year?: number;
  manufacturer?: string;
  set_name?: string;
  parallel?: string;
  card_number?: string | null;
  sport?: SportValue;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// price_cache
// ---------------------------------------------------------------------------

export interface PriceCacheRow {
  id: string;
  card_fingerprint: string;
  avg_sold_price: string | null; // numeric comes back as string from Supabase
  last_10_sales: unknown | null;
  grade: string | null;
  grade_company: GradeCompanyValue | null;
  fetched_at: string;
  expires_at: string;
}

export interface PriceCacheInsert {
  id?: string;
  card_fingerprint: string;
  avg_sold_price?: string | null;
  last_10_sales?: unknown | null;
  grade?: string | null;
  grade_company?: GradeCompanyValue | null;
  fetched_at?: string;
  expires_at: string;
}

export interface PriceCacheUpdate {
  id?: string;
  card_fingerprint?: string;
  avg_sold_price?: string | null;
  last_10_sales?: unknown | null;
  grade?: string | null;
  grade_company?: GradeCompanyValue | null;
  fetched_at?: string;
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// scan_logs
// ---------------------------------------------------------------------------

export interface ScanLogRow {
  id: string;
  user_id: string | null;
  card_id: string | null;
  image_hash: string | null;
  ai_response: unknown | null;
  final_card_id: string | null;
  was_corrected: boolean;
  correction_source: string | null;
  created_at: string;
}

export interface ScanLogInsert {
  id?: string;
  user_id?: string | null;
  card_id?: string | null;
  image_hash?: string | null;
  ai_response?: unknown | null;
  final_card_id?: string | null;
  was_corrected?: boolean;
  correction_source?: string | null;
  created_at?: string;
}

export interface ScanLogUpdate {
  id?: string;
  user_id?: string | null;
  card_id?: string | null;
  image_hash?: string | null;
  ai_response?: unknown | null;
  final_card_id?: string | null;
  was_corrected?: boolean;
  correction_source?: string | null;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  stripe_customer_id: string | null;
  plan_tier: PlanTierValue;
  scans_used_today: number;
  scans_reset_at: string;
}

export interface UserInsert {
  id: string;
  stripe_customer_id?: string | null;
  plan_tier?: PlanTierValue;
  scans_used_today?: number;
  scans_reset_at?: string;
}

export interface UserUpdate {
  id?: string;
  stripe_customer_id?: string | null;
  plan_tier?: PlanTierValue;
  scans_used_today?: number;
  scans_reset_at?: string;
}

// ---------------------------------------------------------------------------
// corrections
// ---------------------------------------------------------------------------

export interface CorrectionRow {
  id: string;
  scan_id: string | null;
  user_id: string | null;
  corrected_labels: unknown;
  created_at: string;
}

export interface CorrectionInsert {
  id?: string;
  scan_id?: string | null;
  user_id?: string | null;
  corrected_labels: unknown;
  created_at?: string;
}

export interface CorrectionUpdate {
  id?: string;
  scan_id?: string | null;
  user_id?: string | null;
  corrected_labels?: unknown;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// training_examples
// ---------------------------------------------------------------------------

export interface TrainingExampleRow {
  id: string;
  image_hash: string;
  correct_labels: unknown;
  source: TrainingSourceValue;
  training_set_id: string | null;
  generation: number;
  created_at: string;
}

export interface TrainingExampleInsert {
  id?: string;
  image_hash: string;
  correct_labels: unknown;
  source: TrainingSourceValue;
  training_set_id?: string | null;
  generation?: number;
  created_at?: string;
}

export interface TrainingExampleUpdate {
  id?: string;
  image_hash?: string;
  correct_labels?: unknown;
  source?: TrainingSourceValue;
  training_set_id?: string | null;
  generation?: number;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// training_runs
// ---------------------------------------------------------------------------

export interface TrainingRunRow {
  id: string;
  openai_job_id: string | null;
  status: TrainingStatusValue;
  model_id: string | null;
  generation: number;
  example_count: number | null;
  started_at: string;
  completed_at: string | null;
  is_active: boolean;
}

export interface TrainingRunInsert {
  id?: string;
  openai_job_id?: string | null;
  status: TrainingStatusValue;
  model_id?: string | null;
  generation: number;
  example_count?: number | null;
  started_at?: string;
  completed_at?: string | null;
  is_active?: boolean;
}

export interface TrainingRunUpdate {
  id?: string;
  openai_job_id?: string | null;
  status?: TrainingStatusValue;
  model_id?: string | null;
  generation?: number;
  example_count?: number | null;
  started_at?: string;
  completed_at?: string | null;
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Database — the typed root passed to createClient<Database>()
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      cards: {
        Row: CardRow;
        Insert: CardInsert;
        Update: CardUpdate;
      };
      price_cache: {
        Row: PriceCacheRow;
        Insert: PriceCacheInsert;
        Update: PriceCacheUpdate;
      };
      scan_logs: {
        Row: ScanLogRow;
        Insert: ScanLogInsert;
        Update: ScanLogUpdate;
      };
      users: {
        Row: UserRow;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      corrections: {
        Row: CorrectionRow;
        Insert: CorrectionInsert;
        Update: CorrectionUpdate;
      };
      training_examples: {
        Row: TrainingExampleRow;
        Insert: TrainingExampleInsert;
        Update: TrainingExampleUpdate;
      };
      training_runs: {
        Row: TrainingRunRow;
        Insert: TrainingRunInsert;
        Update: TrainingRunUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_scan_count: {
        Args: { user_id: string };
        Returns: void;
      };
      insert_correction_with_training: {
        Args: {
          p_scan_id: string;
          p_user_id: string;
          p_corrected_labels: unknown;
          p_image_hash: string;
          p_generation: number;
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
  };
};
