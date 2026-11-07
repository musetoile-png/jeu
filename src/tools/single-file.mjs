// Fabrique un HTML autonome (double-clic, artefact) à partir de dist/ : CSS + JS + images incorporés.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = html.match(/href="\.\/assets\/(index-[^"]+\.css)"/)[1];
const js = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/)[1];
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/[^"]+">/, `<style>${readFileSync(join(dist, 'assets', css), 'utf8')}</style>`);
html = html.replace(/<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>/, '');
const assets = {};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg' };
const embed = (dir, prefix) => {
  let entries = [];
  try { entries = readdirSync(join(dist, 'assets', dir), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { embed(rel, prefix); continue; }
    const type = MIME[e.name.split('.').pop().toLowerCase()];
    if (type) assets[rel] = `data:${type};base64,${readFileSync(join(dist, 'assets', rel)).toString('base64')}`;
  }
};
embed('art');
if (process.argv.includes('--audio')) {
  // Les voix sont recompressées pour la page autonome seulement (limite de 16 Mo) :
  // mono 24 kHz à 40 kb/s, largement suffisant pour la parole. Le dossier du jeu garde les fichiers d'origine.
  const cache = '.cache/audio40';
  mkdirSync(cache, { recursive: true });
  const dir = join(dist, 'assets', 'audio', 'vo', 'zh');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mp3'))) {
    const src = join(dir, f);
    const out = join(cache, f);
    if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-ac', '1', '-ar', '24000', '-b:a', '40k', out]);
    assets[`audio/vo/zh/${f}`] = `data:audio/mpeg;base64,${readFileSync(out).toString('base64')}`;
  }
}
const code = readFileSync(join(dist, 'assets', js), 'utf8').replace(/<\/script>/g, '<\\/script>');
html = html.replace('</body>', `<script>window.__inlineAssets=${JSON.stringify(assets)};</script>\n<script type="module">${code}</script></body>`);
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'dist/premier-soir-shanghai.html';
writeFileSync(out, html);
console.log(out, (html.length / 1e6).toFixed(1), 'Mo');
