import { defineConfig } from 'vite';
import { createSuggestionHandler } from './scripts/gemini-suggestions.mjs';
import { readGeminiConfig } from './scripts/gemini-config.mjs';

function localSuggestions(server, config) {
  const handle = createSuggestionHandler(config);
  server.middlewares.use((req, res, next) => {
    handle(req, res).then(handled => { if (!handled) next(); }).catch(next);
  });
}

export default defineConfig(({ mode }) => {
  const gemini = readGeminiConfig({ mode });
  return {
    plugins: [{
      name: 'human-local-suggestions',
      configureServer: server => localSuggestions(server, gemini),
      configurePreviewServer: server => localSuggestions(server, gemini),
    }],
    build: {
      rollupOptions: {
        output: {
          manualChunks: { three: ['three'], react: ['react', 'react-dom', 'react-dom/client'] },
        },
      },
    },
  };
});
