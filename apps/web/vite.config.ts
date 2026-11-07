/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// La politique de sécurité du contenu n'autorise que l'origine du projet Supabase configuré.
function csp(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  let origine = 'https://*.supabase.co';
  try {
    if (env.VITE_SUPABASE_URL) origine = new URL(env.VITE_SUPABASE_URL).origin;
  } catch {
    /* URL invalide : on garde la valeur par défaut */
  }
  const ws = origine.replace(/^http/, 'ws');
  return {
    name: 'gbs-csp',
    transformIndexHtml: (html) => html.replaceAll('%GBS_CONNECT_SRC%', `${origine} ${ws}`),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), csp(mode)],
  server: { port: 5173 },
  // Aucune ressource inlinée en data: (la CSP n'autorise que 'self' pour les polices).
  build: { sourcemap: false, chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
}));
