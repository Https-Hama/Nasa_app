import { DEFAULT_GEMINI_MODEL } from './gemini-model.mjs';

function httpsOrigin(value, hostnameOnly = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const clean = value.trim();
  try {
    const url = new URL(hostnameOnly && !clean.includes('://') ? `https://${clean}` : clean);
    if (url.protocol !== 'https:' || !url.hostname || url.hostname.includes('*') || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function readHostedOrigins(env = process.env) {
  const custom = typeof env.APP_ORIGIN === 'string' ? env.APP_ORIGIN.split(',') : [];
  const origins = [
    ...custom.map(value => httpsOrigin(value)),
    ...['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'].map(name => httpsOrigin(env[name], true)),
    httpsOrigin(env.URL),
  ].filter(Boolean);
  return [...new Set(origins)];
}

// Cloud functions use runtime environment values, never local credential files.
export function readHostedGeminiConfig(env = process.env) {
  return {
    key: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    allowedOrigins: readHostedOrigins(env),
  };
}
