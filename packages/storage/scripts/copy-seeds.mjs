import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src', 'seeds');
const dst = resolve(here, '..', 'dist', 'seeds');

if (!existsSync(src)) {
  console.log('[copy-seeds] No seeds directory found; skipping.');
  process.exit(0);
}

mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, {
  recursive: true,
  filter: (source) => !source.endsWith('.ts'),
});
console.log(`[copy-seeds] Copied ${src} → ${dst}`);
