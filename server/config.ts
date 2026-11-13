import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/* Vercel may bundle this entry as CommonJS, where import.meta is absent.
   Resolve from __dirname when available, otherwise from the ESM URL. */
const moduleDir =
  typeof __dirname === 'string'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(moduleDir, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

export const VERSION = '2.0.0';
export const PORT = Number(process.env.PORT || 8787);

/* Vercel Functions have a read-only project filesystem. /tmp is the only
   writable location, and it is ephemeral per function instance. */
const DEFAULT_DATA_DIR = process.env.VERCEL ? '/tmp/jarvis' : 'data';
export const DATA_DIR = path.resolve(
  ROOT_DIR,
  process.env.JARVIS_DATA_DIR || DEFAULT_DATA_DIR,
);
export const WORKSPACE_DIR = path.join(DATA_DIR, 'workspace');
export const DB_FILE = path.join(DATA_DIR, 'jarvis.json');
export const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
export const CLIENT_DIST = path.join(ROOT_DIR, 'dist');

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  groq: process.env.GROQ_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  google: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
};

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  native?: 'anthropic';
  local?: boolean;
  keyRequired: boolean;
  hint: string;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  demo: {
    id: 'demo',
    label: 'Simulation Core',
    baseUrl: '',
    model: 'jarvis-sim-1',
    keyRequired: false,
    hint: 'Built-in deterministic agent. No network or key required.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyRequired: true,
    hint: 'OpenAI API key. Any compatible model ID works.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    native: 'anthropic',
    keyRequired: true,
    hint: 'Anthropic Messages API key.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    keyRequired: true,
    hint: 'One key, hundreds of models.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyRequired: true,
    hint: 'Ultra-low latency inference.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyRequired: true,
    hint: 'OpenAI-compatible DeepSeek endpoint.',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
    keyRequired: true,
    hint: 'Google AI Studio key via Gemini’s OpenAI-compatible endpoint.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    keyRequired: true,
    hint: 'Mistral La Plateforme.',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    keyRequired: false,
    local: true,
    hint: 'Local Ollama server. Tool calling depends on the model.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    keyRequired: false,
    local: true,
    hint: 'Local LM Studio OpenAI-compatible server.',
  },
  custom: {
    id: 'custom',
    label: 'Custom endpoint',
    baseUrl: 'http://localhost:8000/v1',
    model: 'model-id',
    keyRequired: false,
    hint: 'Any OpenAI-compatible /chat/completions endpoint.',
  },
};

export function isProviderId(value: string): value is keyof typeof PROVIDERS {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
