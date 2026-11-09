/**
 * Bilan pour l'enseignante : une page HTML autonome, lisible hors ligne, tirée du journal et du carnet.
 * Elle contient aussi les données brutes (CSV) en pièce jointe, pour l'analyse.
 */
import type { Content } from './content';
import { allEvents, toCsv } from './log';
import * as notebook from './notebook';
import * as save from './save';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/** Temps de jeu : somme des écarts entre événements, en ignorant les pauses de plus de 5 minutes. */
function playTime(ts: number[]) {
  let ms = 0;
  let sessions = ts.length ? 1 : 0;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap < 5 * 60_000) ms += gap;
    else sessions++;
  }
  return { minutes: Math.round(ms / 60_000), sessions };
}

function detailOf(detail: string | undefined, key: string) {
  const m = new RegExp(`(?:^|[;,\\s])${key}=([^;,\\s]+)`).exec(detail ?? '');
  return m ? m[1] : undefined;
}

const ERROR_FR: Record<string, string> = {
  phonetic: 'son proche',
  semantic: 'sens voisin',
  contrary: 'contraires inversés',
  classifier: 'classificateur',
  sequence: "ordre des étapes",
  pragmatic: 'situation (pragmatique)',
  grammar: 'grammaire',
  character: 'caractère partagé',
  graphic: 'forme du caractère',
  collocation: 'association de mots',
  tone: 'ton',
  pronoun_written: 'pronom écrit (他/她)',
};

export function buildReport(content: Content, player: string): string {
  const ev = allEvents();
  const p = save.exists() ? save.get() : null;
  const word = (id: string) => content.lexicon.get(id);
  const { minutes, sessions } = playTime(ev.map((e) => e.t));

  // réponses et erreurs
  // une manche d'étal écrit aussi une ligne « answer » : on ne compte que celles-ci pour ne rien doubler
  const answers = ev.filter((e) => e.kind === 'answer');
  const graded = answers.filter((e) => e.ok !== undefined);
  const ok = graded.filter((e) => e.ok).length;
  const errTypes = new Map<string, number>();
  for (const e of answers) {
    if (e.ok !== false) continue;
    const t = detailOf(e.detail, 'errorType') ?? detailOf(e.detail, 'error');
    if (t) errTypes.set(t, (errTypes.get(t) ?? 0) + 1);
  }
  // confusions mot attendu → mot choisi (étals, colophon, détour)
  const conf = new Map<string, number>();
  for (const e of ev) {
    if (e.ok !== false || !e.word) continue;
    const chosen = detailOf(e.detail, 'answer');
    if (chosen && chosen !== e.word) {
      const k = `${e.word}→${chosen}`;
      conf.set(k, (conf.get(k) ?? 0) + 1);
    }
  }
  const listens = ev.filter((e) => e.kind === 'listen');
  const slow = listens.filter((e) => /rate=0\.[0-8]/.test(e.detail ?? '')).length;
  const detours = ev.filter((e) => e.kind === 'detour_start').length;
  const fails = ev.filter((e) => e.kind === 'fail').length;
  const scenes = new Map<string, number>();
  for (const e of ev) if (e.kind === 'scene_end') scenes.set(e.scene, (scenes.get(e.scene) ?? 0) + 1);
  const stallModes = new Map<string, { n: number; ok: number }>();
  for (const e of ev) {
    if (e.kind !== 'stall' || e.ok === undefined) continue;
    const m = detailOf(e.detail, 'mode') ?? '?';
    const s = stallModes.get(m) ?? { n: 0, ok: 0 };
    s.n++;
    if (e.ok) s.ok++;
    stallModes.set(m, s);
  }

  // carnet
  const words = notebook
    .all()
    .map((id) => ({ id, w: word(id), n: notebook.contexts(id), s: notebook.strength(id), e: notebook.recentError(id) }))
    .filter((x) => x.w)
    .sort((a, b) => b.n - a.n);
  const sure = words.filter((x) => x.s >= 3).length;

  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
  const rows = (pairs: [string, string | number][]) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const date = new Date();
  const csv = toCsv();
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const strengthFr = ['vu', 'pâle', 'moyen', 'sûr'];

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bilan Mille li — ${esc(player)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;background:#f3eee3;color:#2b2b33;margin:0;padding:24px 16px}
main{max-width:860px;margin:auto}h1{font-weight:600;margin:0 0 4px}h1 span{color:#c0392b}
h2{font-size:17px;margin:28px 0 8px;border-bottom:2px solid #c0392b33;padding-bottom:4px}
.sub{color:#6b6b72;margin:0 0 16px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:#fffaf0;border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:24px}.kpi small{color:#6b6b72}
table{border-collapse:collapse;width:100%;background:#fffaf0;border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #00000010;vertical-align:top}th{font-weight:500;color:#555}
.zh{font-size:20px}.ok{color:#2e7d5b}.ko{color:#c0392b}a.btn{display:inline-block;background:#c0392b;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none}
.note{color:#6b6b72;font-size:13px}
</style></head><body><main>
<h1><span>千里</span> Mille li — bilan de jeu</h1>
<p class="sub">Joueur ou joueuse : <b>${esc(player)}</b> · exporté le ${esc(date.toLocaleString('fr-FR'))}${
    p ? ` · personnage ${p.profile.body === 'f' ? 'féminin' : 'masculin'}${p.profile.name ? `, nom chinois « ${esc(p.profile.name)} »` : ''}${p.quest ? `, quête « ${esc(p.quest)} »` : ''}` : ''
  }</p>
<div class="kpis">
<div class="kpi"><b>${minutes} min</b><small>temps de jeu estimé · ${sessions} séance(s)</small></div>
<div class="kpi"><b>${words.length}</b><small>mots rencontrés · ${sure} « sûrs » (3 contextes ou plus)</small></div>
<div class="kpi"><b>${pct(ok, graded.length)}</b><small>réponses justes (${ok} / ${graded.length})</small></div>
<div class="kpi"><b>${listens.length}</b><small>écoutes demandées · ${slow} au ralenti</small></div>
<div class="kpi"><b>${detours}</b><small>détours « vaisselle » · ${fails} patience épuisée</small></div>
</div>

<h2>Erreurs par type</h2>
${
  errTypes.size
    ? `<table>${rows([...errTypes].sort((a, b) => b[1] - a[1]).map(([k, n]) => [ERROR_FR[k] ?? k, n] as [string, number]))}</table>`
    : '<p class="note">Aucune erreur typée pour l’instant.</p>'
}

<h2>Confusions les plus fréquentes (mot attendu → mot choisi)</h2>
${
  conf.size
    ? `<table>${[...conf]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, n]) => {
          const [a, b] = k.split('→');
          const wa = word(a);
          const wb = word(b);
          return `<tr><td class="zh">${esc(wa?.target ?? a)} → ${esc(wb?.target ?? b)}</td><td>${esc(wa?.transcription ?? '')} → ${esc(wb?.transcription ?? '')}</td><td>${n} fois</td></tr>`;
        })
        .join('')}</table>`
    : '<p class="note">Pas encore de confusion enregistrée (elles viennent surtout des étals et du colophon).</p>'
}

<h2>Étals : réussite par mode</h2>
${
  stallModes.size
    ? `<table>${rows([...stallModes].map(([m, s]) => [{ listen: 'écouter (听)', read: 'lire (读)', say: 'dire (说)', buy: 'acheter (买)' }[m] ?? m, `${pct(s.ok, s.n)} (${s.ok} / ${s.n})`] as [string, string]))}</table>`
    : '<p class="note">Aucune partie d’étal jouée.</p>'
}

<h2>Carnet de mots</h2>
<p class="note">Un mot devient « sûr » quand il a été reconnu dans au moins trois contextes différents (règle de réemploi : chaque caractère doit voyager).</p>
<table><tr><th>Mot</th><th>Pinyin</th><th>Sens</th><th>Contextes</th><th>Encre</th></tr>
${words
  .map(
    (x) =>
      `<tr><td class="zh">${esc(x.w!.target)}</td><td>${esc(x.w!.transcription)}</td><td>${esc(x.w!.gloss.fr ?? '')}</td><td>${x.n}</td><td class="${x.e ? 'ko' : x.s >= 3 ? 'ok' : ''}">${strengthFr[x.s]}${x.e ? ' · erreur récente' : ''}</td></tr>`,
  )
  .join('')}
</table>

<h2>Scènes terminées</h2>
<table>${rows([...scenes].map(([k, n]) => [k, `${n} fois`] as [string, string]))}</table>

<h2>Données brutes</h2>
<p><a class="btn" download="journal-${esc(player)}-${date.toISOString().slice(0, 10)}.csv" href="${csvHref}">Télécharger le journal complet (CSV, ${ev.length} événements)</a></p>
<p class="note">Une ligne par événement : horodatage, scène, étape, type (answer, listen, stall, detour…), mot, juste/faux, contexte nouveau ou connu, détail (type d’erreur, vitesse d’écoute, mode d’étal…).</p>
</main></body></html>`;
}
