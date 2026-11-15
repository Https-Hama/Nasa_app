import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { DEFAULT_GEMINI_MODEL } from './gemini-model.mjs';
export { DEFAULT_GEMINI_MODEL } from './gemini-model.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// Loaded by the server only. These values are never exposed through VITE_ variables.
export function readGeminiConfig({ root = projectRoot, mode = 'production', env = process.env } = {}) {
  if (!/^[a-z0-9_-]+$/i.test(mode)) throw new Error('Invalid server configuration mode.');
  const files = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try { Object.assign(files, parseEnv(readFileSync(resolve(root, name), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {
    key: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || files.GEMINI_API_KEY || files.GOOGLE_API_KEY,
    model: env.GEMINI_MODEL || files.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  };
}
