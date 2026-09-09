import { defineConfig } from 'vite';

// GitHub Pages 用に base をリポジトリ名にしておく（ローカル開発では '/' でよい）。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/AI-fighter/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: { host: '127.0.0.1', port: 5173 },
}));
