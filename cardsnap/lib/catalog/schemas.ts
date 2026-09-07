/**
 * lib/catalog/schemas.ts
 *
 * Zod schemas for TCGdex v2 API responses (https://api.tcgdex.net/v2/en).
 *
 * TCGdex returns different field sets per card category (Pokemon / Trainer /
 * Energy), and adds fields over time, so every schema here is loose: unknown
 * keys are kept, and anything the catalog does not read is left unmodelled.
 * The parsed object doubles as the `raw` jsonb column — no separate copy.
 *
 * Field shapes verified against real responses in __tests__/fixtures/.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** cardmarket / tcgplayer price blocks are large and irregular — kept as-is. */
const PricingBlockSchema = z.looseObject({
  cardmarket: z.unknown().optional(),
  tcgplayer: z.unknown().optional(),
});

const VariantFlagsSchema = z.looseObject({
  firstEdition: z.boolean().optional(),
  holo: z.boolean().optional(),
  normal: z.boolean().optional(),
  reverse: z.boolean().optional(),
  wPromo: z.boolean().optional(),
});

/** One entry in variants_detailed. `foil` appears only on some sets/eras. */
const VariantDetailedSchema = z.looseObject({
  type: z.string(),
  size: z.string().optional(),
  foil: z.string().optional(),
  variantId: z.string().optional(),
});

const CardCountSchema = z.looseObject({
  official: z.number().optional(),
  total: z.number().optional(),
  normal: z.number().optional(),
  holo: z.number().optional(),
  reverse: z.number().optional(),
  firstEd: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

/** A card as embedded in a set response — brief form. */
export const TcgdexSetCardBriefSchema = z.looseObject({
  id: z.string(),
  localId: z.union([z.string(), z.number()]),
  name: z.string(),
  image: z.string().optional(),
});
export type TcgdexSetCardBrief = z.infer<typeof TcgdexSetCardBriefSchema>;

export const TcgdexSetSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  serie: z.looseObject({ id: z.string(), name: z.string() }).optional(),
  cardCount: CardCountSchema.optional(),
  releaseDate: z.string().optional(),
  symbol: z.string().optional(),
  logo: z.string().optional(),
  cards: z.array(TcgdexSetCardBriefSchema).optional(),
});
export type TcgdexSet = z.infer<typeof TcgdexSetSchema>;

/** A set as embedded in the top-level set list. */
export const TcgdexSetListEntrySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  cardCount: CardCountSchema.optional(),
  logo: z.string().optional(),
  symbol: z.string().optional(),
});
export type TcgdexSetListEntry = z.infer<typeof TcgdexSetListEntrySchema>;

export const TcgdexSetListSchema = z.array(TcgdexSetListEntrySchema);

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const TcgdexCardSchema = z.looseObject({
  id: z.string(),
  localId: z.union([z.string(), z.number()]),
  name: z.string(),
  category: z.string().optional(), // Pokemon | Trainer | Energy
  rarity: z.string().optional(),
  illustrator: z.string().optional(),
  image: z.string().optional(),
  dexId: z.array(z.number()).optional(),
  stage: z.string().optional(),
  suffix: z.string().optional(),
  trainerType: z.string().optional(),
  energyType: z.string().optional(),
  variants: VariantFlagsSchema.optional(),
  variants_detailed: z.array(VariantDetailedSchema).optional(),
  pricing: PricingBlockSchema.optional(),
  updated: z.string().optional(),
  set: z
    .looseObject({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
});
export type TcgdexCard = z.infer<typeof TcgdexCardSchema>;
