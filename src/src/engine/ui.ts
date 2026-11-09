/**
 * Interface HTML posée sur le canvas : écran titre, sac, quête, album, notifications.
 * Aucun texte de langue cible ici : tout vient du contenu.
 */
import { speak, RATE } from './audio';
import type { Content, Ending, PickOption, Place, Quest, Scene, Step, Token } from './content';
import { assetUrl, lineText, t } from './content';
import { log } from './log';
import * as notebook from './notebook';
import * as save from './save';
import { play } from './sfx';
import { fmt } from './stall';

const stage = () => document.getElementById('stage') as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Un mot en grand, à l'encre plus ou moins foncée selon le nombre de contextes (comme le carnet). */
export function inkWord(content: Content, wordId: string, withPinyin = true) {
  const e = content.lexicon.get(wordId);
  const req = content.language.mastery?.contextsRequired ?? 3;
  const box = el('span', `ink ink-${notebook.strength(wordId, req)}`);
  box.append(el('b', '', e?.target ?? wordId));
  if (withPinyin) box.append(el('i', '', e?.transcription ?? ''));
  box.title = t(content, e?.gloss);
  box.onclick = () => e && speak(content, e.target, `w_${wordId}`, RATE.WORD);
  return box;
}

const hasAsset = (path: string | undefined) => {
  const inline = (window as unknown as { __inlineAssets?: Record<string, string> }).__inlineAssets;
  return !!path && (!inline || !!inline[path]);
};

function imageOrInk(content: Content, image: string | undefined, wordId: string) {
  const path = image ? content.pack.assets.images[image] : undefined;
  if (!hasAsset(path)) return inkWord(content, wordId, false);
  if (path) {
    const img = el('img');
    img.src = assetUrl(path);
    img.alt = '';
    img.onerror = () => img.replaceWith(inkWord(content, wordId, false));
    return img;
  }
  return inkWord(content, wordId, false);
}

// ---------- Moments animés ----------

const animating = new Set<string>();

/**
 * Pendant une animation (arrivée dans un lieu, chien, valise, ouverture), les barres d'interaction
 * s'effacent : rien ne se superpose à l'image. Plusieurs sources peuvent la demander en même temps.
 */
export function setAnim(key: string, on: boolean) {
  if (on) animating.add(key);
  else animating.delete(key);
  document.body.classList.toggle('anim', animating.size > 0);
}

// ---------- Notifications ----------

export function toast(content: Content, wordId: string, caption: string) {
  const box = el('div', 'toast');
  box.append(inkWord(content, wordId), el('span', '', caption));
  stage().appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

/** Cartouche plein écran au changement de jour ou de lieu. */
export function card(content: Content, zh: string, fr: string) {
  stage().querySelector('.placecard')?.remove();
  const c = el('div', 'placecard');
  c.append(el('b', '', zh), el('i', '', fr));
  stage().appendChild(c);
  setTimeout(() => c.remove(), 4000);
  void content;
}

// ---------- Panneaux ----------

function panel(title: string, onClose?: () => void) {
  stage().querySelector('.panel')?.remove();
  play('page');
  const p = el('section', 'panel');
  const head = el('header');
  const close = el('button', 'sm', '✕');
  close.setAttribute('aria-label', 'Fermer');
  close.onclick = () => {
    play('tap');
    p.remove();
    onClose?.();
  };
  head.append(el('h2', '', title), close);
  p.append(head);
  stage().appendChild(p);
  return p;
}

export function closePanel() {
  stage().querySelector('.panel')?.remove();
}

export const panelOpen = () => !!stage().querySelector('.panel');

export function showBag(content: Content) {
  const p = panel(content.ui.bag ?? 'Sac');
  const grid = el('div', 'bag');
  for (const id of save.get().items) {
    const it = content.items.get(id);
    if (!it) continue;
    const card = el('button', 'item');
    card.append(imageOrInk(content, it.image, it.word), inkWord(content, it.word));
    const gloss = el('small', '', t(content, content.lexicon.get(it.word)?.gloss));
    card.append(gloss);
    card.onclick = () => {
      if (it.usage) {
        const line = save.resolveLine(content, it.usage.line);
        speak(content, lineText(content, line), it.usage.vo, RATE.NORMAL);
        detail.textContent = `${lineText(content, line)} — ${t(content, it.usage.gloss)}${it.from ? ' · ' + t(content, it.from) : ''}`;
      }
      log({ scene: 'sac', step: 0, kind: 'listen', word: it.word, detail: `item=${it.id}` });
    };
    grid.append(card);
  }
  const detail = el('p', 'detail', content.ui.bagHint ?? '');
  p.append(grid, detail);
}

/** Réglage pīn du lecteur de scènes (absent = pinyin affiché dans les répliques). */
function pinyinSetting(): 'on' | 'off' | '' {
  try {
    const v = localStorage.getItem('jeu-zh-pinyin');
    return v === 'on' || v === 'off' ? v : '';
  } catch {
    return '';
  }
}

function setPinyinSetting(on: boolean) {
  try {
    localStorage.setItem('jeu-zh-pinyin', on ? 'on' : 'off');
  } catch {
    /* navigation privée : réglage non mémorisé */
  }
}

/** Une ligne de liste est-elle cochée ? (drapeau « fait », ou sujet photo dans l'album) */
const lineDone = (it: NonNullable<Quest['list']>[number]) => (it.subject ? save.hasPhoto(it.subject) : !!it.flag && save.flag(it.flag) === 'fait');

/** Avancement d'une liste : lignes cochées, total, objectif. */
export function errandProgress(e: Quest) {
  const list = e.list ?? [];
  return { n: list.filter(lineDone).length, total: list.length, goal: Math.min(e.goal ?? list.length, list.length) };
}

/** Sceau rouge (caractères de la récompense, en colonne). */
function seal(content: Content, line: Token[]) {
  const s = el('span', 'seal');
  s.append(el('b', '', lineText(content, line)));
  return s;
}

export function showQuest(content: Content) {
  const p = panel(content.ui.quest ?? 'Quête');
  const d = save.get();
  // listes en cours (courses, photos) : chaque mot à l'encre, coché quand c'est fait
  for (const e of [...content.quests.values()].filter((x) => x.kind === 'errand' && save.hasItem(x.item) && save.matches(x.when) && (x.stay || save.flag(x.id) !== 'fait'))) {
    const box = el('div', 'errand');
    const head = el('h3');
    if (e.head) for (const tok of e.head) if (tok[0] === 'w') head.append(inkWord(content, tok[1], false));
    head.append(el('span', e.head ? 'sub' : '', t(content, e.title)));
    box.append(head, el('p', 'pitch', t(content, e.pitch)));
    const prog = errandProgress(e);
    if (e.goal !== undefined) {
      const bar = el('p', 'tally', fmt(content.ui.listTally ?? '{n} / {total}', { n: String(prog.n), total: String(prog.total), goal: String(prog.goal) }));
      box.append(bar);
    }
    // liste à lire : sans pinyin tant que le joueur n'a pas allumé pīn ; un bouton pīn le montre (même réglage que les scènes)
    const readOnly = !!e.readOnly;
    const ul = el('ul', 'checklist');
    const draw = () => {
      ul.replaceChildren();
      const py = !readOnly || pinyinSetting() === 'on';
      for (const it of e.list ?? []) {
        const done = lineDone(it);
        const li = el('li', done ? 'done' : '');
        li.append(el('span', 'tick', done ? '✓' : ''), inkWord(content, it.word, py));
        // la traduction n'apparaît qu'une fois la ligne cochée : avant, c'est au joueur de lire
        const note = readOnly ? (done ? t(content, content.lexicon.get(it.word)?.gloss) : '') : t(content, it.who);
        if (note) li.append(el('small', '', note));
        ul.append(li);
      }
    };
    draw();
    if (readOnly) {
      const pyBtn = el('button', 'sm pybtn', 'pīn');
      pyBtn.title = content.ui.pinyin ?? 'pinyin';
      const sync = () => pyBtn.setAttribute('aria-pressed', String(pinyinSetting() === 'on'));
      sync();
      pyBtn.onclick = () => {
        setPinyinSetting(pinyinSetting() !== 'on');
        sync();
        draw();
        log({ scene: `liste:${e.id}`, step: 0, kind: 'listen', detail: `pinyin=${pinyinSetting()}` });
      };
      head.append(pyBtn);
    }
    box.append(ul);
    if (e.reward && (save.flag(e.id) === 'pret' || save.flag(e.id) === 'fait')) box.append(seal(content, e.reward.seal));
    p.append(box);
  }
  const q = d.quest ? content.quests.get(d.quest) : undefined;
  if (!q?.steps) {
    if (!p.querySelector('.errand')) p.append(el('p', 'detail', content.ui.noQuest ?? ''));
    return;
  }
  const step = q.steps[Math.min(d.questStep[q.id] ?? 0, q.steps.length - 1)];
  p.append(el('h3', '', t(content, q.title)), el('p', 'pitch', t(content, q.pitch)));
  const dl = el('dl', 'journal');
  for (const [k, v] of [
    [content.ui.questKnow, step.know],
    [content.ui.questSeek, step.seek],
    [content.ui.questWhere, step.where],
  ] as const) {
    dl.append(el('dt', '', k ?? ''), el('dd', '', t(content, v)));
  }
  p.append(dl);
}

/**
 * Une liste qui atteint son objectif passe à « pret » (courses à rapporter, page d'album gagnée).
 * Renvoie les listes pour lesquelles ça vient d'arriver.
 */
export function checkErrands(content: Content): Quest[] {
  const ready: Quest[] = [];
  for (const e of content.quests.values()) {
    if (e.kind !== 'errand' || !e.list?.length || save.flag(e.id) || !save.matches(e.when)) continue;
    const { n, goal } = errandProgress(e);
    if (n >= goal) {
      save.setFlags({ [e.id]: 'pret' });
      ready.push(e);
    }
  }
  return ready;
}

/** L'objet reçu vole jusqu'au sac (bouton « Sac » sous le jeu). */
export function flyToBag(content: Content, itemId: string, from?: { x: number; y: number }) {
  const it = content.items.get(itemId);
  const path = it?.image ? content.pack.assets.images[it.image] : undefined;
  const node = hasAsset(path) ? Object.assign(el('img', 'flyer'), { src: assetUrl(path as string), alt: '' }) : inkWord(content, it?.word ?? itemId, false);
  fly(node, from);
}

/**
 * Un article acheté qui n'est pas un objet du sac : il part au sac dans un petit sac de provisions en papier kraft
 * (avec son image, ou son caractère au pinceau).
 */
export function flyProvision(content: Content, wordId: string, imageUrl?: string, from?: { x: number; y: number }) {
  const bag = el('span', 'provision');
  if (imageUrl) bag.append(Object.assign(el('img'), { src: imageUrl, alt: '' }));
  else bag.append(el('b', '', content.lexicon.get(wordId)?.target ?? ''));
  fly(bag, from);
}

function fly(node: HTMLElement, from?: { x: number; y: number }) {
  const bag = document.querySelector<HTMLElement>('[data-panel="bag"]');
  const st = stage().getBoundingClientRect();
  if (!bag) return;
  const b = bag.getBoundingClientRect();
  node.classList.add('flyer');
  document.body.append(node);
  const sx = st.left + (from?.x ?? 0.5) * st.width;
  const sy = st.top + (from?.y ?? 0.45) * st.height;
  node.animate(
    [
      { transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(.3)`, opacity: 0 },
      { transform: `translate(${sx}px, ${sy - 40}px) translate(-50%, -50%) scale(1.1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${b.left + b.width / 2}px, ${b.top + b.height / 2}px) translate(-50%, -50%) scale(.25)`, opacity: 0.9 },
    ],
    { duration: 1300, easing: 'cubic-bezier(.45,0,.3,1)' },
  ).onfinish = () => {
    node.remove();
    play('item');
    bag.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380 });
  };
}

/** Album : chaque page = la photo (réelle si fournie, sinon le décor recadré), le mot, le crédit. */
export function showAlbum(content: Content) {
  const p = panel(content.ui.album ?? 'Album');
  const grid = el('div', 'album');
  const album = save.get().album;
  if (!album.length) p.append(el('p', 'detail', content.ui.albumEmpty ?? ''));
  // page de titre au sceau rouge : la liste de photos est remplie
  for (const e of content.quests.values()) {
    if (!e.reward || !(save.flag(e.id) === 'pret' || save.flag(e.id) === 'fait')) continue;
    const page = el('figure', 'page seal-page');
    const title = el('div', 'seal-title');
    for (const tok of e.reward.seal) if (tok[0] === 'w') title.append(inkWord(content, tok[1], false));
    title.append(seal(content, e.reward.seal));
    const prog = errandProgress(e);
    const cap = el('figcaption', '', fmt(t(content, e.reward.caption), { n: String(prog.n), total: String(prog.total) }));
    page.append(title, cap);
    grid.append(page);
  }
  for (const ph of album) {
    const page = el('figure', 'page');
    const place = content.places.get(ph.place);
    const spot = place?.hotspots.find((h) => h.id === ph.subject);
    const prompt = spot?.prompt ?? place?.ambient?.find((a) => a.subject === ph.subject)?.prompt;
    const real0 = spot?.photo ? content.pack.assets.images[spot.photo] : undefined;
    // une vraie photo ne s'affiche qu'avec son crédit (licences libres : l'auteur doit être cité)
    const real = hasAsset(real0) && spot?.photo && content.credits[spot.photo] ? real0 : undefined;
    const pic = el('div', 'pic');
    if (real) {
      const img = el('img');
      img.src = assetUrl(real);
      img.alt = '';
      img.onerror = () => {
        img.remove();
        paintCrop(content, pic, place, ph.rect, ph.extra);
      };
      pic.append(img);
    } else paintCrop(content, pic, place, ph.rect, ph.extra);
    const cap = el('figcaption');
    cap.append(inkWord(content, ph.word), el('span', '', t(content, prompt)));
    const credit = spot?.photo ? content.credits[spot.photo] : undefined;
    if (real && credit) {
      const a = el('a', 'credit', `© ${credit.author} · ${credit.license}`);
      a.href = credit.url;
      a.target = '_blank';
      a.rel = 'noopener';
      cap.append(a);
    }
    page.append(pic, cap);
    grid.append(page);
  }
  p.append(grid);
}

/** Redessine un cadrage à partir des plans du lieu (aucune image stockée dans la sauvegarde). */
function paintCrop(content: Content, box: HTMLElement, place: Place | undefined, r: { x: number; y: number; w: number; h: number }, extra?: save.Photo['extra']) {
  if (!place) return;
  box.classList.add('crop');
  const W = place.size.width;
  const H = place.size.height;
  const layers = place.planes
    .filter((pl) => pl.depth !== 'above')
    .map((pl) => content.pack.assets.images[pl.image])
    .filter(Boolean)
    .reverse()
    .map((path) => `url("${assetUrl(path as string)}")`);
  box.style.backgroundImage = layers.join(',');
  box.style.backgroundSize = `${(W / r.w) * 100}% ${(H / r.h) * 100}%`;
  const px = r.w >= W ? 0 : (r.x / (W - r.w)) * 100;
  const py = r.h >= H ? 0 : (r.y / (H - r.h)) * 100;
  box.style.backgroundPosition = `${px}% ${py}%`;
  // le chat photographié : son image posée là où il était (la sauvegarde ne garde que sa place)
  const path = extra ? content.pack.assets.images[extra.image] : undefined;
  if (extra && path && hasAsset(path)) {
    const img = el('img', 'extra');
    img.src = assetUrl(path);
    img.alt = '';
    img.style.height = `${(extra.h / r.h) * 100}%`;
    img.style.left = `${((extra.x - r.x) / r.w) * 100}%`;
    img.style.top = `${((extra.y - extra.h - r.y) / r.h) * 100}%`;
    if (extra.flip) img.style.transform = 'translateX(-50%) scaleX(-1)';
    box.append(img);
  }
}

// ---------- Écran titre ----------

export interface TitleChoice {
  mode: 'new' | 'continue';
  body: 'm' | 'f';
}

export function showTitle(content: Content, onStart: (c: TitleChoice) => void) {
  const title = content.pack.title;
  const prof = content.pack.profile;
  const box = el('div', 'title-screen');
  const scroll = el('div', 'scroll');
  // Les caractères du titre foncent à mesure que le joueur les rencontre en jeu (même règle que le carnet).
  const h = el('h2', 'title-zh');
  for (const tok of title?.line ?? []) if (tok[0] === 'w') h.append(inkWord(content, tok[1], false));
  scroll.append(h, el('p', 'title-fr', title?.fr ?? ''), el('p', 'title-sub', t(content, title?.sub)));
  if (title?.chapter) scroll.append(el('p', 'title-chapter', `${title.chapter.zh ?? ''} · ${t(content, title.chapter)}`));

  const pick = el('div', 'bodies');
  let body: 'm' | 'f' | null = null;
  const start = el('button', 'go', content.ui.start ?? 'Commencer');
  start.disabled = true;
  for (const b of prof?.bodies ?? []) {
    const btn = el('button', 'body');
    const path = content.pack.assets.images[b.front];
    if (hasAsset(path)) {
      const img = el('img');
      img.src = assetUrl(path);
      img.alt = '';
      img.onerror = () => img.replaceWith(el('span', 'silhouette'));
      btn.append(img);
    } else btn.append(el('span', 'silhouette'));
    btn.append(el('span', '', t(content, b.label)));
    btn.onclick = () => {
      body = b.id;
      pick.querySelectorAll('.body').forEach((x) => x.classList.toggle('on', x === btn));
      start.disabled = false;
    };
    pick.append(btn);
  }
  scroll.append(el('p', 'title-ask', content.ui.chooseBody ?? ''), pick);
  const actions = el('div', 'title-actions');
  start.onclick = () => {
    if (!body) return;
    box.remove();
    log({ scene: 'titre', step: 0, kind: 'scene_start', detail: `body=${body}` });
    onStart({ mode: 'new', body });
  };
  actions.append(start);
  if (save.exists()) {
    const cont = el('button', '', content.ui.continue_game ?? 'Continuer');
    cont.onclick = () => {
      box.remove();
      onStart({ mode: 'continue', body: save.get().profile.body });
    };
    actions.prepend(cont);
  }
  scroll.append(actions);
  box.append(scroll);
  stage().appendChild(box);
}

/** Petite plaque « fermé » sur une porte : le verrou est une phrase à lire. */
export function signText(content: Content, line: Token[]) {
  return lineText(content, line);
}

// ---------- Séquences animées ----------

/**
 * « La valise » : le soir, dans la chambre, la valise s'ouvre, une lumière chaude en sort,
 * les objets de la quête montent et flottent ; on en touche un, son histoire s'écrit, la lampe s'éteint.
 */
export function cinematic(content: Content, scene: Scene, step: Step, done: (o?: PickOption) => void) {
  const box = el('div', 'cine valise');
  setAnim('cine', true);
  const backdrop = step.backdrop ? content.pack.assets.images[step.backdrop] : undefined;
  box.innerHTML = `
    <div class="room"><div class="window"><span class="moon"></span><span class="roofs"></span></div><div class="lamp"></div></div>
    <p class="narration"></p>
    <div class="suitcase"><div class="sc-glow"></div><div class="sc-body"><div class="sc-inside"></div></div><div class="sc-lid"><span class="sc-handle"></span></div></div>
    <div class="sc-items"></div>
    <div class="sc-story"><h3></h3><p></p><button class="go"></button></div>`;
  if (backdrop && hasAsset(backdrop)) {
    // chambre dessinée : elle remplace la chambre en aplats (la lampe et la fenêtre sont dans l'image)
    box.classList.add('painted');
    (box.querySelector('.room') as HTMLElement).style.backgroundImage = `url("${assetUrl(backdrop)}")`;
  }
  stage().appendChild(box);
  const narr = box.querySelector('.narration') as HTMLElement;
  narr.textContent = t(content, step.narration);
  const items = box.querySelector('.sc-items') as HTMLElement;
  const story = box.querySelector('.sc-story') as HTMLElement;
  const opts = step.options ?? [];

  // 1. la lampe s'allume, la phrase s'écrit ; 2. la valise s'ouvre ; 3. les objets montent
  requestAnimationFrame(() => box.classList.add('on'));
  setTimeout(() => box.classList.add('open'), 1800);
  setTimeout(() => {
    opts.forEach((o, i) => {
      const obj = scene.objects[o.object];
      const item = [...content.items.values()].find((it) => it.word === obj?.word);
      const quest = [...content.quests.values()].find((q) => q.item === item?.id);
      const b = el('button', 'sc-item');
      b.style.setProperty('--x', `${opts.length === 1 ? 50 : 28 + (44 * i) / (opts.length - 1)}%`);
      b.style.setProperty('--d', `${i * 0.35}s`);
      const path = obj ? content.pack.assets.images[obj.image] : undefined;
      if (hasAsset(path)) {
        const img = el('img');
        img.src = assetUrl(path as string);
        img.alt = '';
        b.append(img);
      }
      if (obj) b.append(inkWord(content, obj.word));
      b.append(el('small', '', t(content, o.caption)));
      b.onmouseenter = () => {
        const e = obj ? content.lexicon.get(obj.word) : undefined;
        if (e) speak(content, e.target, `w_${obj!.word}`, RATE.WORD);
      };
      b.onclick = () => {
        if (box.classList.contains('chosen')) return;
        box.classList.add('chosen');
        b.classList.add('picked');
        if (obj) notebook.meet(obj.word, `cinematic:${scene.id}`);
        (story.querySelector('h3') as HTMLElement).textContent = quest ? t(content, quest.title) : '';
        const para = story.querySelector('p') as HTMLElement;
        const text = quest ? t(content, quest.pitch) : '';
        let k = 0;
        const type = () => {
          para.textContent = text.slice(0, k);
          k += 2;
          if (k <= text.length + 1) setTimeout(type, 22);
          else go.hidden = false;
        };
        const go = story.querySelector('button') as HTMLButtonElement;
        go.hidden = true;
        go.textContent = content.ui.sleep ?? 'Dormir';
        go.onclick = () => {
          box.classList.add('night');
          setTimeout(() => {
            box.remove();
            done(o);
            setAnim('cine', false);
          }, 1600);
        };
        setTimeout(type, 900);
      };
      items.append(b);
    });
  }, 3100);
}

/**
 * Fin de chapitre : l'image de fin avance lentement, une phrase calligraphiée (et sa voix) s'y pose,
 * puis un cartouche de papier : le titre-carnet (千里, à l'encre du carnet), le chapitre achevé, la suite.
 * Le bouton ramène à l'écran titre ; la partie est sauvegardée (« Continuer » rouvre le train).
 */
export function ending(content: Content, e: Ending) {
  setAnim('ending', true);
  const box = el('div', 'cine ending');
  const path = content.pack.assets.images[e.image];
  const img = el('div', 'ending-img');
  if (path && hasAsset(path)) img.style.backgroundImage = `url("${assetUrl(path)}")`;
  box.append(img);
  if (e.line) box.append(el('p', 'ending-line', lineText(content, e.line)));
  const card = el('div', 'ending-card');
  const zh = el('div', 'ending-title');
  const title = content.pack.title;
  for (const tok of title?.line ?? []) if (tok[0] === 'w') zh.append(inkWord(content, tok[1], false));
  card.append(zh, el('p', 'ending-chapter', t(content, e.title)));
  if (e.next) card.append(el('p', 'ending-next', t(content, e.next)));
  const back = el('button', 'go', content.ui.backToTitle);
  back.onclick = () => {
    play('tap');
    // l'écran titre, sans les raccourcis de test de l'adresse
    location.href = location.pathname;
  };
  card.append(back);
  box.append(card);
  stage().appendChild(box);
  requestAnimationFrame(() => {
    box.classList.add('on');
  });
  setTimeout(() => {
    box.classList.add('line');
    if (e.line) speak(content, lineText(content, e.line), e.vo, RATE.NORMAL);
  }, 2200);
  setTimeout(() => {
    box.classList.add('card');
  }, 5200);
}

/**
 * Ouverture : l'avion descend sur la ville. L'image avance lentement, le nom du lieu s'écrit à l'encre
 * et se prononce, une phrase pose la scène. Un clic (ou la fin) passe à la ruelle.
 */
export function intro(content: Content, done: () => void) {
  const it = content.pack.intro;
  const path = it ? content.pack.assets.images[it.image] : undefined;
  if (!it || !hasAsset(path)) {
    done();
    return;
  }
  setAnim('intro', true);
  const box = el('div', 'cine intro');
  const img = el('div', 'intro-img');
  img.style.backgroundImage = `url("${assetUrl(path as string)}")`;
  const e = content.lexicon.get(it.word);
  const word = el('div', 'intro-word');
  word.append(el('b', '', e?.target ?? ''), el('i', '', e?.transcription ?? ''));
  const line = el('p', 'intro-line', t(content, it.text));
  const skip = el('button', 'intro-skip', '›');
  box.append(img, word, line, skip);
  stage().appendChild(box);
  requestAnimationFrame(() => box.classList.add('on'));
  const timers = [
    setTimeout(() => {
      box.classList.add('word');
      if (e) speak(content, e.target, `w_${it.word}`, RATE.WORD);
      notebook.meet(it.word, 'intro');
    }, 2200),
    setTimeout(() => box.classList.add('line'), 3800),
    setTimeout(() => finish(), 9500),
  ];
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    timers.forEach(clearTimeout);
    box.classList.add('night');
    setTimeout(() => {
      box.remove();
      done();
      setAnim('intro', false);
    }, 1400);
  };
  box.onclick = finish;
}
