import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const root = resolve(import.meta.dirname, '../..');
const DISKS = process.env.SHIZUKU_DISKS ?? join(root, '../pc98/fixtures/private/shizuku');
const ES = process.env.SHIZUKU_ES ?? join(root, '../shizuku-es');

/**
 * Dev only: serves the developer's own disks at /__dev/disks/, so `pnpm dev`
 * starts without importing them. Never part of a build.
 */
function devDisks(): Plugin {
  return {
    name: 'shizuku-dev-disks',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/disks', (req, res) => {
        const name = decodeURIComponent((req.url ?? '/').slice(1));
        if (name === '') {
          const list = existsSync(DISKS) ? readdirSync(DISKS).filter((f) => /\.(hdm|fdi|d88)$/i.test(f)) : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(list));
          return;
        }
        const file = join(DISKS, name);
        if (!/^[\w.-]+$/.test(name) || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.end(readFileSync(file));
      });
    },
  };
}

/**
 * `virtual:translation`: the Spanish translation and the Japanese font table
 * from the private shizuku-es repo, when it is next to this one. Without it
 * the build ships no translation and the game falls back to codes.
 */
function translation(): Plugin {
  const id = 'virtual:translation';
  return {
    name: 'shizuku-translation',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const scenarios: Record<string, unknown> = {};
      const dir = join(ES, 'es');
      if (existsSync(dir)) {
        for (const f of readdirSync(dir).filter((f) => /^SCN\d+\.json$/.test(f))) {
          this.addWatchFile(join(dir, f));
          scenarios[Number(f.slice(3, 6))] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        }
      }
      const tablePath = join(ES, 'reference/font-table.jp.txt');
      const fontTable = existsSync(tablePath) ? readFileSync(tablePath, 'utf8') : '';
      return `export const scenarios = ${JSON.stringify(scenarios)};\nexport const fontTable = ${JSON.stringify(fontTable)};`;
    },
  };
}

export default defineConfig({
  base: './',
  // AudioWorklet modules run outside the page: keep Preact's hot reload out of them.
  plugins: [preact({ exclude: [/worklet/] }), devDisks(), translation()],
  // The audio worklet must stay a real file: Safari will not load it from a data: URL.
  build: { target: 'es2022', assetsInlineLimit: (file) => (file.includes('worklet') ? false : undefined) },
});
