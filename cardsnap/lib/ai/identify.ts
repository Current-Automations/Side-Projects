/**
 * lib/ai/identify.ts
 *
 * GPT-4o vision client. Takes a card image (base64 or URL), preprocesses it,
 * asks GPT-4o to identify the card, and validates the response against the
 * canonical CardIdentificationSchema. Retries once with a stricter prompt if
 * the model returns malformed or non-conforming output.
 */

import OpenAI from 'openai';
import sharp from 'sharp';
import { requireOpenAIKey } from '@/lib/types/env';
import {
  parseIdentificationJson,
  type CardIdentification,
} from '@/lib/types/identification';

const DEFAULT_MODEL = 'gpt-4o';
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 85;

export type IdentifyErrorCode =
  | 'INVALID_IMAGE'
  | 'OPENAI_ERROR'
  | 'AI_DECLINED'
  | 'IDENTIFICATION_FAILED';

export type IdentifyResult =
  | { success: true; data: CardIdentification }
  | { success: false; error: string; code: IdentifyErrorCode; raw?: unknown };

const SYSTEM_PROMPT = `You are a sports card identification expert with encyclopedic knowledge of NFL, NBA, MLB, and NHL trading cards from 1980 to present. You can identify cards from partial images and distinguish parallels, variations, and serial-numbered editions. You always return valid JSON and never guess — if uncertain, lower the confidence score.`;

const FIELD_SPEC = `Return a JSON object with these exact fields:
- sport: one of "NFL", "NBA", "MLB", "NHL"
- player_name: string
- year: number between 1980 and 2030
- manufacturer: one of "Panini", "Topps", "Upper Deck", "Leaf", "Donruss"
- product_line: string (the product/set line, e.g. "Prizm", "Select", "SP Authentic")
- set_variant: string, optional (a sub-set or insert name)
- card_number: string, optional
- parallel_name: string (the parallel/variation name; use "Base" if it is not a parallel)
- serial_number: string, optional (format "/25" or "1/1")
- is_graded: boolean
- grade_company: string, optional, one of "PSA", "BGS", "SGC", "CGC" (required when is_graded is true)
- grade_value: string, optional (e.g. "9", "9.5", "10")
- bgs_black_label: boolean, optional
- confidence: number between 0 and 1 (overall confidence)
- parallel_confidence: number between 0 and 1 (confidence specifically in the parallel/variation)

If this is not a sports card or the image is too blurry to identify, return: {"error": "reason"}

Return ONLY the JSON object. No explanation, no markdown, no backticks.`;

const USER_PROMPT = `Analyze this sports card image. ${FIELD_SPEC}`;

const RETRY_USER_PROMPT = `Your previous response could not be parsed as a valid card identification. Look at the image again carefully and respond strictly. ${FIELD_SPEC}`;

type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: requireOpenAIKey() });
  }
  return _client;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadImageBuffer(image: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image);
    if (!res.ok) {
      throw new Error(`failed to fetch image URL (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  // Accept both raw base64 and data URIs ("data:image/png;base64,....").
  const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  return Buffer.from(base64, 'base64');
}

/** Resize to <= 1024px on the longest side and normalize to JPEG, returned as a data URI. */
async function preprocessImage(image: string): Promise<string> {
  const input = await loadImageBuffer(image);
  const jpeg = await sharp(input)
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function logUsage(model: string, attempt: number, usage: TokenUsage | null | undefined): void {
  if (process.env.NODE_ENV !== 'production' && usage) {
    console.log(
      `[identify] model=${model} attempt=${attempt} ` +
        `prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} ` +
        `total_tokens=${usage.total_tokens}`
    );
  }
}

async function requestIdentification(
  dataUri: string,
  model: string,
  userPrompt: string
): Promise<{ text: string; usage: TokenUsage | null | undefined }> {
  const completion = await getClient().chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ],
      },
    ],
  });

  return {
    text: completion.choices[0]?.message?.content ?? '',
    usage: completion.usage,
  };
}

/**
 * Identify a sports card from an image.
 *
 * @param image base64 string (raw or data URI) or an http(s) image URL
 * @param options.model override the model — pass the active fine-tuned model id here
 */
export async function identify(
  image: string,
  options?: { model?: string }
): Promise<IdentifyResult> {
  let dataUri: string;
  try {
    dataUri = await preprocessImage(image);
  } catch (err) {
    return {
      success: false,
      error: `Could not read image: ${errorMessage(err)}`,
      code: 'INVALID_IMAGE',
    };
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const prompts = [USER_PROMPT, RETRY_USER_PROMPT];

  let lastError = 'Identification failed';
  let lastRaw: unknown;

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    let text: string;
    let usage: TokenUsage | null | undefined;
    try {
      const res = await requestIdentification(dataUri, model, prompts[attempt]);
      text = res.text;
      usage = res.usage;
    } catch (err) {
      return {
        success: false,
        error: `OpenAI request failed: ${errorMessage(err)}`,
        code: 'OPENAI_ERROR',
      };
    }

    logUsage(model, attempt + 1, usage);

    const parsed = parseIdentificationJson(text);
    if (parsed.success) {
      return { success: true, data: parsed.data };
    }

    // The model explicitly declined — retrying the same image won't help.
    if (parsed.code === 'AI_ERROR') {
      return { success: false, error: parsed.error, code: 'AI_DECLINED', raw: text };
    }

    lastError = parsed.error;
    lastRaw = text;
  }

  return {
    success: false,
    error: lastError,
    code: 'IDENTIFICATION_FAILED',
    raw: lastRaw,
  };
}
