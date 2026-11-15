import { defineConfig } from 'vite';
import { createSuggestionHandler } from './scripts/gemini-suggestions.mjs';

function localSuggestions(server) {
  const handle = createSuggestionHandler();
  server.middlewares.use((req,res,next) => {
    handle(req,res).then(handled => { if (!handled) next(); }).catch(next);
  });
}

export default defineConfig({
  plugins: [{name:'human-local-suggestions', configureServer:localSuggestions, configurePreviewServer:localSuggestions}],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'react': ['react','react-dom','react-dom/client'],
        },
      },
    },
  },
});
