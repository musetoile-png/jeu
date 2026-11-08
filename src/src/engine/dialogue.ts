/**
 * Lecteur de scènes : affiche les répliques en HTML par-dessus le canvas,
 * gère les choix, les « pick » (dictée-wok), la patience, l'audio et le journal.
 */
import { preloadVoices, RATE, speak, speakWords, stop } from './audio';
import type { Choice, Content, PickOption, Restore, Scene, Step, Token } from './content';
import { lineText, lineWords, t } from './content';
import { log } from './log';
import * as notebook from './notebook';
import * as save from './save';
import { play as sound } from './sfx';
import { cinematic, flyToBag, toast } from './ui';

export interface DialogueHost {
  /** Appelé quand la scène se termine (succès) ou est fermée. */
  onClose: (success: boolean) => void;
  /** Permet à la scène Phaser de réagir (surbrillance d'objets, effets). */
  onEffect?: (effect: string) => void;
  imageUrl: (key: string) => string | undefined;
  /** Haut de la tête du personnage, en fraction de l'image (0..1) ; null = hors champ (voix off). */
  anchor?: (actorId: string) => { x: number; y: number } | null;
  /** Côté où poser le panneau d'action : à l'opposé des personnages cadrés par la caméra. */
  side?: 'left' | 'right';
  /** Un personnage prend la parole (petit mouvement de la marionnette). */
  onSpeak?: (actorId: string) => void;
}

export class Dialogue {
  private root: HTMLElement;
  /** Bulle de bande dessinée au-dessus de celui qui parle. */
  private bubble: HTMLElement;
  /** Qui parle en ce moment (id d'acteur, ou 'player'). */
  private speaker = '';
  private live = false;
  private keys = (e: KeyboardEvent) => this.onKey(e);
  private i = 0;
  private patience = 0;
  private words: Token[] = [];
  private subtitles = true;
  private el: Record<string, HTMLElement> = {};

  /** Paires de mots confondus pendant la scène (mot choisi, mot attendu) : matière du détour. */
  private confusions: [string, string][] = [];

  /** Feuille posée sur la scène pendant une étape « restore » (ligne abîmée), retirée ensuite. */
  private sheet: HTMLElement | null = null;
  /** Cases déjà restaurées, par étape : un détour ou un nouvel affichage ne fait jamais tout recommencer. */
  private restored = new Map<number, Set<number>>();

  private content: Content;
  private scene: Scene;
  private host: DialogueHost;

  constructor(content: Content, scene: Scene, host: DialogueHost) {
    this.content = content;
    this.scene = scene;
    this.host = host;
    this.root = document.getElementById('dlg') as HTMLElement;
    // Panneau d'action compact, posé dans un coin libre : outils d'écoute, réponses, retour.
    this.root.innerHTML = `
      <div class="tools">
        <button class="ic" id="dlg-slow"></button><button class="ic" id="dlg-normal"></button><button class="ic" id="dlg-words"></button><button class="ic" id="dlg-sub"></button><button class="ic" id="dlg-py"></button>
        <span class="patience" id="dlg-pat"></span>
      </div>
      <div id="dlg-body"></div>
      <div class="feedback" id="dlg-fb"></div>`;
    this.root.className = `side-${host.side ?? 'right'}`;
    // La réplique elle-même vit dans une bulle, au-dessus de la tête de celui qui parle.
    const stage = document.getElementById('stage') as HTMLElement;
    this.bubble = document.getElementById('bubble') ?? stage.appendChild(Object.assign(document.createElement('div'), { id: 'bubble' }));
    this.bubble.className = 'bubble';
    this.bubble.hidden = true;
    this.bubble.innerHTML = `
      <div class="who"><img class="portrait" id="dlg-portrait" alt="" /><span class="n" id="dlg-who"></span><span class="whofr" id="dlg-whofr"></span></div>
      <div class="line" id="dlg-line"></div>
      <div class="fr" id="dlg-fr"></div>`;
    this.bubble.onclick = () => (this.root.querySelector('#dlg-body > button.go') as HTMLButtonElement | null)?.click();
    for (const id of ['portrait', 'who', 'whofr', 'pat', 'line', 'fr', 'slow', 'normal', 'words', 'sub', 'py', 'body', 'fb'])
      this.el[id] = document.getElementById(`dlg-${id}`) as HTMLElement;
    const ui = content.ui;
    const icon = (el: HTMLElement, glyph: string, label: string) => {
      el.textContent = glyph;
      el.title = label;
      el.setAttribute('aria-label', label);
    };
    icon(this.el.slow, '🐢', ui.slow);
    icon(this.el.normal, '🔊', ui.normal);
    icon(this.el.words, '字', ui.wordByWord);
    icon(this.el.sub, 'FR', ui.subtitles);
    this.el.slow.onclick = () => this.sayLine(this.words, this.currentVo, RATE.SLOW);
    this.el.normal.onclick = () => this.sayLine(this.words, this.currentVo, RATE.NORMAL);
    this.el.words.onclick = () => speakWords(content, lineWords(this.words));
    icon(this.el.py, 'pīn', ui.pinyin ?? 'pinyin');
    const pinyinOn = () => {
      try {
        return localStorage.getItem('jeu-zh-pinyin') !== 'off';
      } catch {
        return true;
      }
    };
    const applyPinyin = (on: boolean) => {
      this.root.classList.toggle('no-py', !on);
      this.bubble.classList.toggle('no-py', !on);
      this.el.py.style.opacity = on ? '1' : '.5';
      this.el.py.setAttribute('aria-pressed', String(on));
    };
    applyPinyin(pinyinOn());
    this.el.py.onclick = () => {
      const on = this.root.classList.contains('no-py');
      try {
        localStorage.setItem('jeu-zh-pinyin', on ? 'on' : 'off');
      } catch {
        /* navigation privée : réglage non mémorisé */
      }
      applyPinyin(on);
      log({ scene: this.scene.id, step: this.i, kind: 'listen', detail: `pinyin=${on ? 'on' : 'off'}` });
    };
    this.el.sub.onclick = () => {
      this.subtitles = !this.subtitles;
      this.el.fr.classList.toggle('off', !this.subtitles);
      this.el.sub.style.opacity = this.subtitles ? '1' : '.5';
    };
  }

  private currentVo: string | undefined;

  /** Pose la bulle au-dessus de la tête de celui qui parle (suit la caméra) ; hors champ, elle se range en haut à gauche. */
  private placeBubble() {
    if (this.bubble.hidden) return;
    const stage = this.bubble.parentElement as HTMLElement;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const a = this.speaker ? this.host.anchor?.(this.speaker) : null;
    this.bubble.classList.toggle('off', !a);
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    if (!a) {
      // une ligne à restaurer posée en haut à gauche : la voix hors champ se range juste dessous
      let below = 0;
      if (this.sheet) {
        const sr = this.sheet.getBoundingClientRect();
        const st = stage.getBoundingClientRect();
        if (sr.left - st.left < W * 0.03 + bw) below = sr.bottom - st.top + 10;
      }
      this.bubble.style.left = `${Math.round(W * 0.03)}px`;
      this.bubble.style.top = `${Math.round(Math.max(H * 0.05, below))}px`;
      return;
    }
    const hx = a.x * W;
    const left = Math.max(8, Math.min(W - bw - 8, hx - bw / 2));
    const top = Math.max(8, a.y * H - bh - 18);
    this.bubble.style.left = `${Math.round(left)}px`;
    this.bubble.style.top = `${Math.round(top)}px`;
    this.bubble.style.setProperty('--tail', `${Math.round(Math.max(22, Math.min(bw - 22, hx - left)))}px`);
  }

  /** Espace / Entrée : continuer ; 1, 2, 3… : choisir une réponse. */
  private onKey(e: KeyboardEvent) {
    if (this.root.hidden || document.querySelector('.cine')) return;
    const go = this.root.querySelector<HTMLButtonElement>('#dlg-body > button.go');
    if ((e.key === ' ' || e.key === 'Enter') && go) {
      e.preventDefault();
      go.click();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const btns = this.root.querySelectorAll<HTMLButtonElement>('#dlg-body .choices button:not([disabled]), #dlg-body .picks button.pick:not([disabled])');
      btns[n - 1]?.click();
    }
  }

  open() {
    this.i = 0;
    this.preload();
    this.setPatience(this.scene.patience);
    this.root.hidden = false;
    this.live = true;
    document.body.classList.add('talking');
    document.addEventListener('keydown', this.keys);
    const tick = () => {
      if (!this.live) return;
      this.placeBubble();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    log({ scene: this.scene.id, step: 0, kind: 'scene_start' });
    this.step();
  }

  /**
   * Les répliques de la scène (personnage et réponses du joueur) sont demandées dès l'ouverture :
   * aucune n'attend le réseau. Les mots isolés restent chargés à la demande (téléphone, petite connexion).
   */
  private preload() {
    const fill = (vo?: string) => (vo ? save.fill(vo, this.content) : undefined);
    const vos = this.scene.steps.flatMap((st) => [fill(st.vo), ...(st.choices ?? []).map((ch) => fill(ch.vo))]);
    preloadVoices(this.content, [...new Set(vos)]);
  }

  close(success: boolean) {
    stop();
    this.live = false;
    document.body.classList.remove('talking');
    document.removeEventListener('keydown', this.keys);
    this.root.hidden = true;
    this.bubble.hidden = true;
    this.clearSheet();
    log({ scene: this.scene.id, step: this.i, kind: 'scene_end', ok: success });
    this.host.onClose(success);
  }

  private setPatience(n: number) {
    this.patience = n;
    this.el.pat.innerHTML = '';
    for (let k = 0; k < this.scene.patience; k++) {
      const dot = document.createElement('i');
      if (k < n) dot.className = 'on';
      this.el.pat.appendChild(dot);
    }
  }

  private setActor(actorId: string | undefined, expression = 'neutral') {
    const actor = actorId ? this.scene.actors[actorId] : undefined;
    this.speaker = actorId ?? '';
    this.bubble.classList.toggle('me', actorId === 'player');
    // le joueur parle sous son nom chinois, s'il en a choisi un
    const me = actorId === 'player' ? this.content.pack.profile?.names.find((n) => n.id === save.get().profile.name)?.zh : undefined;
    this.el.who.textContent = me ?? actor?.name ?? '';
    this.el.whofr.textContent = actor ? t(this.content, actor.label) : '';
    const img = this.el.portrait as HTMLImageElement;
    const url = actor ? this.host.imageUrl(`portrait_${actor.portrait}_${expression}`) ?? this.host.imageUrl(`portrait_${actor.portrait}_neutral`) : undefined;
    img.hidden = !url;
    if (url) img.src = url;
  }

  private wordEl(tok: Token): HTMLElement {
    const s = document.createElement('span');
    const b = document.createElement('b');
    const i = document.createElement('i');
    if (tok[0] === 'w') {
      const e = this.content.lexicon.get(tok[1]);
      s.className = 'w';
      b.textContent = e?.target ?? tok[1];
      i.textContent = e?.transcription ?? '';
      s.title = t(this.content, e?.gloss);
      s.tabIndex = 0;
      s.onclick = (ev) => {
        ev.stopPropagation();
        if (e) speak(this.content, e.target, `w_${tok[1]}`, RATE.WORD);
        log({ scene: this.scene.id, step: this.i, kind: 'listen', word: tok[1], detail: 'word' });
      };
    } else if (tok[0] === 't') {
      s.className = 'w';
      b.textContent = tok[1];
      i.textContent = tok[2];
      s.title = tok[3];
    } else {
      s.className = 'w punct';
      b.textContent = tok[1];
    }
    s.append(b, i);
    return s;
  }

  private showLine(raw: Token[], gloss: string) {
    const line = save.resolveLine(this.content, raw);
    gloss = save.fill(gloss, this.content);
    this.words = line;
    this.el.line.innerHTML = '';
    // les mots se posent un à un, comme un pinceau qui avance (sans retarder la voix)
    line.forEach((tok, k) => {
      const w = this.wordEl(tok);
      w.style.setProperty('--k', String(k));
      this.el.line.appendChild(w);
    });
    this.el.fr.textContent = gloss;
    this.el.fr.classList.toggle('off', !this.subtitles);
    // nouvelle réplique : la bulle « éclot » à nouveau, celui qui parle s'anime
    if (this.speaker) this.host.onSpeak?.(this.speaker);
    this.bubble.hidden = false;
    this.bubble.classList.remove('pop');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('pop');
    this.placeBubble();
    const ctx = lineText(this.content, line);
    for (const id of lineWords(line)) {
      const status = notebook.meet(id, ctx);
      log({ scene: this.scene.id, step: this.i, kind: 'word_met', word: id, context: status });
    }
    document.dispatchEvent(new CustomEvent('notebook-changed'));
  }

  private sayLine(raw: Token[], rawVo: string | undefined, rate: number, onEnd?: () => void) {
    const line = save.resolveLine(this.content, raw);
    const vo = rawVo ? save.fill(rawVo, this.content) : undefined;
    this.currentVo = vo;
    log({ scene: this.scene.id, step: this.i, kind: 'listen', detail: `rate=${rate}` });
    speak(this.content, lineText(this.content, line), vo, rate, onEnd);
  }

  private feedback(msg: string, cls: '' | 'good' | 'bad') {
    this.el.fb.textContent = msg;
    this.el.fb.className = `feedback ${cls}`;
  }

  /**
   * Mauvaise réponse. La patience baisse (la tension reste), mais on ne repart JAMAIS du début :
   * à zéro, le personnage soupire, montre la bonne réponse, et la patience revient.
   * `replay` : rejouer la question du personnage après la réponse fautive (on réécoute ce qui était demandé).
   */
  private lose(why: string, errorType: string | undefined, words: string[], container: HTMLElement, replay?: () => void) {
    sound('bad');
    this.setPatience(this.patience - 1);
    this.bubble.classList.remove('shake');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('shake');
    words.forEach((w) => notebook.mark(w, false));
    log({ scene: this.scene.id, step: this.i, kind: 'answer', ok: false, detail: `errorType=${errorType ?? '?'}` });
    const actor = this.scene.actors[this.scene.npc];
    if (actor) this.setActor(this.scene.npc, 'surprise');
    const detour = this.scene.onExhausted && this.content.pack.detours?.[this.scene.onExhausted.detour];
    if (this.patience <= 0 && detour && this.scene.onExhausted) {
      this.feedback(why, 'bad');
      log({ scene: this.scene.id, step: this.i, kind: 'fail', detail: 'detour' });
      setTimeout(() => this.detour(detour, this.scene.onExhausted!.refill), 1400);
      return;
    }
    if (this.patience <= 0) {
      this.feedback(`${why} — ${this.el.who.textContent} ${this.content.ui.outOfPatience}`, 'bad');
      log({ scene: this.scene.id, step: this.i, kind: 'fail', detail: 'hint' });
      container.querySelectorAll<HTMLElement>('[data-ok="1"]').forEach((b) => b.classList.add('show-answer'));
      this.setPatience(this.scene.patience);
    } else this.feedback(why, 'bad');
    if (replay) setTimeout(replay, 700);
  }

  private win(gloss: string, words: string[], next: () => void) {
    sound('good');
    words.forEach((w) => notebook.mark(w, true));
    log({ scene: this.scene.id, step: this.i, kind: 'answer', ok: true });
    this.feedback(`${this.content.ui.right} ${gloss}`, 'good');
    next();
  }

  private step() {
    const s: Step | undefined = this.scene.steps[this.i];
    const body = this.el.body;
    body.innerHTML = '';
    this.feedback('', '');
    this.clearSheet();
    if (!s) return this.close(true);
    // une étape sans réplique (choix, wok) garde la question précédente dans la bulle
    if (s.line || s.expression || this.i === 0) this.setActor(s.actor ?? (s.type === 'say' ? undefined : this.scene.npc), s.expression);
    if (s.highlight) this.host.onEffect?.(`highlight:${s.highlight.join(',')}`);
    if (s.effect) this.host.onEffect?.(s.effect);

    // dernière réplique d'une scène : pas besoin de cliquer « Terminer », le jeu reprend seul
    // une fois la voix finie et le temps de lire la traduction (le bouton reste pour aller plus vite)
    const autoEnd = s.type === 'say' && s.end;
    let ended = false;
    const at = this.i;
    const finish = () => {
      if (ended) return;
      ended = true;
      if (this.live && this.i === at) this.close(true);
    };
    const readMs = 1200 + Math.min(2500, t(this.content, s.gloss).length * 30);
    if (s.line) {
      this.showLine(s.line, t(this.content, s.gloss));
      this.sayLine(s.line, s.vo, RATE.NORMAL, autoEnd ? () => setTimeout(finish, readMs) : undefined);
    }
    // filet de sécurité : si la voix ne prévient pas de sa fin (son bloqué), on reprend quand même
    if (autoEnd) setTimeout(finish, (s.line ? 7000 : 0) + readMs);

    if (s.type === 'say') {
      this.exchange(s);
      const b = document.createElement('button');
      b.className = 'go';
      b.textContent = s.end ? this.content.ui.finish : this.content.ui.continue;
      b.onclick = () => {
        sound('tap');
        if (s.end) this.close(true);
        else this.advance();
      };
      body.appendChild(b);
    }

    if (s.type === 'choose') this.renderChoose(s, s.choices ?? []);
    if (s.type === 'pick') this.renderPick(s, s.options ?? []);
    if (s.type === 'cinematic') this.renderCinematic(s);
    if (s.type === 'restore' && s.restore) this.renderRestore(s, s.restore);
  }

  private advance() {
    this.i++;
    this.step();
  }

  /** Objets qui changent de main : le mot est montré et prononcé, l'événement journalisé. */
  private exchange(s: Step) {
    for (const id of s.give ?? []) {
      if (save.hasItem(id)) continue;
      save.addItem(id);
      const it = this.content.items.get(id);
      // l'objet passe de la main du personnage au sac
      flyToBag(this.content, id, this.host.anchor?.(this.scene.npc) ?? undefined);
      if (it) {
        toast(this.content, it.word, `${this.content.ui.received ?? '+'} ${t(this.content, this.content.lexicon.get(it.word)?.gloss)}`);
        notebook.meet(it.word, `item:${id}`);
      }
      log({ scene: this.scene.id, step: this.i, kind: 'item_get', detail: id, word: it?.word });
    }
    for (const id of s.take ?? []) {
      if (!save.hasItem(id)) continue;
      save.removeItem(id);
      const it = this.content.items.get(id);
      if (it) toast(this.content, it.word, `${this.content.ui.lost ?? '−'} ${t(this.content, this.content.lexicon.get(it.word)?.gloss)}`);
      log({ scene: this.scene.id, step: this.i, kind: 'item_lose', detail: id, word: it?.word });
    }
  }

  /** Mémorise le mot choisi à tort et le mot attendu (ceux qui diffèrent entre les deux réponses). */
  private confuse(chosen: string[], expected: string[]) {
    const a = chosen.filter((w) => !expected.includes(w));
    const b = expected.filter((w) => !chosen.includes(w));
    if (a[0] && b[0]) this.confusions.push([a[0], b[0]]);
  }

  /**
   * Détour : à patience zéro, on ne recommence pas. Petite tâche du monde (la vaisselle) :
   * chaque bol = un mot entendu, à reconnaître parmi deux caractères, sans pinyin. Puis retour à l'étape.
   */
  private detour(d: NonNullable<Content['pack']['detours']>[string], refill: number) {
    const body = this.el.body;
    body.innerHTML = '';
    this.feedback('', '');
    this.setActor(d.actor, 'neutral');
    this.showLine(d.go.line, t(this.content, d.go.gloss));
    this.sayLine(d.go.line, d.go.vo, RATE.NORMAL);
    log({ scene: this.scene.id, step: this.i, kind: 'detour_start', detail: this.confusions.map((c) => c.join('/')).join(',') });

    // les confusions du joueur d'abord, complétées par des paires tirées des mots de la scène
    const pool = [...new Set(this.scene.steps.flatMap((s) => lineWords(s.line ?? [])))].filter((w) => this.content.lexicon.has(w));
    const pairs = [...this.confusions].reverse();
    while (pairs.length < d.bowls && pool.length > 1) {
      const a = pool[Math.floor(Math.random() * pool.length)];
      const b = pool[Math.floor(Math.random() * pool.length)];
      if (a !== b) pairs.push([b, a]);
    }
    const todo = pairs.slice(0, d.bowls);

    const ask = document.createElement('div');
    ask.className = 'fr';
    ask.textContent = t(this.content, d.ask);
    const bowls = document.createElement('div');
    bowls.className = 'bowls';
    const area = document.createElement('div');
    area.className = 'picks';
    body.append(ask, bowls, area);
    todo.forEach(() => bowls.appendChild(Object.assign(document.createElement('span'), { className: 'bowl' })));

    let k = 0;
    const next = () => {
      area.innerHTML = '';
      if (k >= todo.length) {
        log({ scene: this.scene.id, step: this.i, kind: 'detour_end' });
        this.showLine(d.back.line, t(this.content, d.back.gloss));
        this.sayLine(d.back.line, d.back.vo, RATE.NORMAL, () =>
          setTimeout(() => {
            this.confusions = [];
            this.setPatience(Math.min(refill, this.scene.patience));
            this.step();
            this.setPatience(Math.min(refill, this.scene.patience));
          }, 400),
        );
        return;
      }
      const [wrong, target] = todo[k];
      const entry = this.content.lexicon.get(target);
      const play = () => entry && speak(this.content, entry.target, `w_${target}`, RATE.WORD);
      play();
      const again = document.createElement('button');
      again.className = 'sm';
      again.textContent = this.content.ui.listenAgain ?? '🔊';
      again.onclick = play;
      area.append(again);
      for (const w of [target, wrong].sort(() => Math.random() - 0.5)) {
        const b = document.createElement('button');
        b.className = 'pick hanzi';
        const ph = document.createElement('span');
        ph.className = 'ph';
        ph.textContent = this.content.lexicon.get(w)?.target ?? w;
        b.append(ph);
        b.onclick = () => {
          const ok = w === target;
          notebook.mark(target, ok);
          log({ scene: this.scene.id, step: this.i, kind: 'answer', ok, word: target, detail: `detour:${w}` });
          sound(ok ? 'good' : 'bad');
          if (ok) {
            notebook.meet(target, `detour:${this.scene.id}`);
            bowls.children[k]?.classList.add('clean');
            k++;
            setTimeout(next, 500);
          } else {
            b.classList.add('nope', 'wrong');
            play();
          }
        };
        area.append(b);
      }
    };
    setTimeout(next, 1600);
  }

  private renderChoose(s: Step, choices: Choice[]) {
    const body = this.el.body;
    if (s.ask) {
      const ask = document.createElement('div');
      ask.className = 'fr';
      ask.textContent = t(this.content, s.ask);
      body.appendChild(ask);
    }
    const c = document.createElement('div');
    c.className = 'choices';
    // l'ordre est mélangé : la bonne réponse ne doit pas toujours être la première.
    // Les choix libres (prénom, nom chinois, pays) gardent leur ordre, qui suit ce que le personnage vient de dire.
    const order = choices.map((ch, idx) => ({ ch, idx }));
    if (!s.free) {
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
    }
    order.forEach(({ ch, idx }) => {
      const b = document.createElement('button');
      if (ch.ok || s.free) b.dataset.ok = '1';
      save.resolveLine(this.content, ch.line).forEach((tok) => b.appendChild(this.wordEl(tok)));
      b.title = t(this.content, ch.gloss);
      b.onclick = () => {
        const words = lineWords(ch.line);
        log({ scene: this.scene.id, step: this.i, kind: 'answer', detail: `choice=${idx + 1}` });
        if (ch.ok || s.free) {
          if (ch.set) {
            save.set(ch.set);
            log({ scene: this.scene.id, step: this.i, kind: 'choice_set', detail: JSON.stringify(ch.set) });
          }
          this.exchange(s);
          c.querySelectorAll('button').forEach((x) => (x.disabled = true));
          b.classList.add('right');
          this.setActor('player');
          this.showLine(ch.line, t(this.content, ch.gloss));
          this.win(t(this.content, ch.gloss), words, () => this.sayLine(ch.line, ch.vo, RATE.NORMAL, () => setTimeout(() => (s.end ? this.close(true) : this.advance()), 350)));
        } else {
          // on entend ce qu'on a dit, puis le personnage repose sa question
          // la voix du joueur suit le corps choisi ({body}) : sans ce remplissage, le fichier manquait et le navigateur lisait avec sa propre voix
          speak(this.content, lineText(this.content, save.resolveLine(this.content, ch.line)), ch.vo ? save.fill(ch.vo, this.content) : undefined, RATE.NORMAL, () =>
            s.line ? setTimeout(() => this.sayLine(s.line!, s.vo, RATE.NORMAL), 500) : undefined,
          );
          b.classList.remove('wrong');
          void b.offsetWidth;
          b.classList.add('wrong');
          const right = choices.find((x) => x.ok);
          if (right) this.confuse(words, lineWords(right.line));
          this.lose(t(this.content, ch.why), ch.errorType, words, c);
        }
      };
      c.appendChild(b);
    });
    body.appendChild(c);
  }

  private clearSheet() {
    this.sheet?.remove();
    this.sheet = null;
  }

  /**
   * Restauration d'une ligne abîmée (colophon d'un rouleau, enseigne, stèle…). La ligne s'affiche en grand
   * sur un papier ancien, les caractères manquants en cases pâles. Pour chaque case, quelques caractères
   * connus sont proposés, sans transcription au départ (l'écoute du mot reste possible).
   * Bonne réponse : le caractère s'imprime à l'encre et compte au carnet. Mauvaise : explication, la patience
   * baisse, les transcriptions apparaissent ; on ne recommence jamais. Une fois tout restauré, le personnage lit la ligne.
   */
  private renderRestore(s: Step, r: Restore) {
    const body = this.el.body;
    const line = save.resolveLine(this.content, r.line);
    const ctx = lineText(this.content, line);
    // chaque caractère garde le mot dont il vient (carnet, écoute)
    const cells: { ch: string; word?: string; punct: boolean }[] = [];
    for (const tok of line) {
      const text = tok[0] === 'w' ? (this.content.lexicon.get(tok[1])?.target ?? '') : tok[0] === 'v' ? '' : tok[1];
      for (const ch of text) cells.push({ ch, word: tok[0] === 'w' ? tok[1] : undefined, punct: tok[0] === 'p' });
    }
    const gaps = r.gaps.filter((g) => g.at >= 0 && g.at < cells.length);
    const done = this.restored.get(this.i) ?? new Set<number>();
    this.restored.set(this.i, done);

    // la feuille, posée du côté du panneau d'action (les personnages sont cadrés de l'autre côté)
    const sheet = document.createElement('div');
    sheet.className = `restore side-${this.host.side ?? 'right'}${r.vertical ? ' vertical' : ''}`;
    const paper = document.createElement('div');
    paper.className = 'paper';
    paper.style.setProperty('--n', String(cells.length));
    const boxes = cells.map((c, k) => {
      const box = document.createElement('span');
      const g = gaps.findIndex((x) => x.at === k);
      box.className = `rc${c.punct ? ' punct' : ''}${g >= 0 ? ' gap' : ''}${g >= 0 && done.has(g) ? ' inked' : ''}`;
      box.textContent = g >= 0 && !done.has(g) ? '' : c.ch;
      paper.appendChild(box);
      return box;
    });
    sheet.appendChild(paper);
    this.bubble.parentElement?.appendChild(sheet);
    this.sheet = sheet;

    const ask = document.createElement('div');
    ask.className = 'fr';
    ask.textContent = t(this.content, s.ask) || (this.content.ui.restoreAsk ?? '');
    const listen = document.createElement('button');
    listen.className = 'sm restore-listen';
    listen.textContent = this.content.ui.restoreListen ?? '🔊';
    const grid = document.createElement('div');
    grid.className = 'picks restore-picks';
    body.append(ask, listen, grid);

    const finish = () => {
      ask.remove();
      listen.remove();
      grid.remove();
      this.feedback('', '');
      sheet.classList.add('done');
      log({ scene: this.scene.id, step: this.i, kind: 'answer', ok: true, detail: 'restore=complete' });
      // le personnage lit la ligne entière, à voix haute
      this.setActor(s.actor ?? this.scene.npc, 'joy');
      this.showLine(r.line, t(this.content, r.gloss));
      setTimeout(() => {
        if (this.live && this.sheet === sheet) this.sayLine(r.line, r.vo, RATE.NORMAL);
      }, 600);
      const go = document.createElement('button');
      go.className = 'go';
      go.textContent = s.end ? this.content.ui.finish : this.content.ui.continue;
      go.onclick = () => {
        sound('tap');
        if (s.end) this.close(true);
        else this.advance();
      };
      body.appendChild(go);
    };

    const next = () => {
      grid.innerHTML = '';
      grid.classList.remove('show-py');
      for (const b of boxes) b.classList.remove('active');
      const g = gaps.findIndex((_, k) => !done.has(k));
      if (g < 0) {
        finish();
        return;
      }
      const gap = gaps[g];
      const cell = cells[gap.at];
      const box = boxes[gap.at];
      box.classList.add('active');
      const entry = cell.word ? this.content.lexicon.get(cell.word) : undefined;
      listen.hidden = !entry;
      listen.onclick = () => {
        if (!entry || !cell.word) return;
        speak(this.content, entry.target, `w_${cell.word}`, RATE.WORD);
        log({ scene: this.scene.id, step: this.i, kind: 'listen', word: cell.word, detail: `restore:${String(gap.at)}` });
      };
      // l'ordre est mélangé : la position ne doit rien révéler
      const order = [...gap.options];
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
      for (const o of order) {
        const b = document.createElement('button');
        b.className = 'pick hanzi restore-pick';
        if (o.ok) b.dataset.ok = '1';
        const ph = document.createElement('span');
        ph.className = 'ph';
        ph.textContent = o.char;
        const py = document.createElement('span');
        py.className = 'cap restore-py';
        py.textContent = o.transcription ?? '';
        b.append(ph, py);
        b.onclick = () => {
          log({ scene: this.scene.id, step: this.i, kind: 'answer', word: cell.word, detail: `restore:${String(gap.at)}=${o.char}` });
          if (o.ok) {
            grid.querySelectorAll('button').forEach((x) => (x.disabled = true));
            b.classList.add('right');
            done.add(g);
            box.textContent = cell.ch;
            box.classList.remove('active');
            box.classList.add('inked');
            if (cell.word) notebook.meet(cell.word, ctx);
            document.dispatchEvent(new CustomEvent('notebook-changed'));
            this.win(`${o.char} ${o.transcription ?? ''}`.trim(), cell.word ? [cell.word] : [], () => setTimeout(next, 900));
          } else {
            b.disabled = true;
            b.classList.add('wrong', 'nope');
            // après une erreur, les transcriptions aident à départager
            grid.classList.add('show-py');
            box.classList.remove('shake');
            box.getBoundingClientRect(); // relance l'animation
            box.classList.add('shake');
            if (o.word && cell.word) this.confuse([o.word], [cell.word]);
            this.lose(t(this.content, o.why), o.errorType, cell.word ? [cell.word] : [], grid);
          }
        };
        grid.appendChild(b);
      }
    };
    next();
  }

  /** Séquence animée : le dialogue s'efface, la scène plein écran rend la main avec l'option choisie. */
  private renderCinematic(s: Step) {
    stop();
    this.root.hidden = true;
    this.bubble.hidden = true;
    cinematic(this.content, this.scene, s, (o) => {
      if (o?.set) {
        save.set(o.set);
        log({ scene: this.scene.id, step: this.i, kind: 'choice_set', detail: JSON.stringify(o.set) });
      }
      // l'objet choisi (la carte de Léo, la section de rouleau) rejoint le sac
      const word = o ? this.scene.objects[o.object]?.word : undefined;
      if (word && this.content.items.has(word) && !save.hasItem(word)) {
        save.addItem(word);
        log({ scene: this.scene.id, step: this.i, kind: 'item_get', detail: word, word });
      }
      this.root.hidden = false;
      if (s.end) this.close(true);
      else this.advance();
    });
  }

  private renderPick(s: Step, options: PickOption[]) {
    const body = this.el.body;
    const ask = document.createElement('div');
    ask.className = 'fr';
    ask.textContent = t(this.content, s.ask);
    body.appendChild(ask);
    const grid = document.createElement('div');
    grid.className = 'picks';
    // Les options sont mélangées : la position ne doit rien révéler.
    [...options]
      .sort(() => Math.random() - 0.5)
      .forEach((o) => {
        const obj = this.scene.objects[o.object];
        const entry = this.content.lexicon.get(obj.word);
        const b = document.createElement('button');
        b.className = 'pick';
        if (o.ok || s.free) b.dataset.ok = '1';
        const url = this.host.imageUrl(obj.image);
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          b.appendChild(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'ph';
          ph.textContent = entry?.target ?? '?';
          b.appendChild(ph);
        }
        const cap = document.createElement('span');
        cap.className = 'cap';
        // Jamais la traduction ici : c'est le caractère (ou l'image) qu'il faut reconnaître. Seule la quantité est écrite.
        cap.textContent = o.caption ? t(this.content, o.caption) : o.qty ? (this.content.ui[`qty_${o.qty}`] ?? o.qty) : '';
        b.appendChild(cap);
        b.onclick = () => {
          log({ scene: this.scene.id, step: this.i, kind: 'answer', detail: `pick=${o.object}${o.qty ? ':' + o.qty : ''}` });
          if (o.ok || s.free) {
            if (o.set) {
              save.set(o.set);
              log({ scene: this.scene.id, step: this.i, kind: 'choice_set', detail: JSON.stringify(o.set) });
            }
            this.exchange(s);
            grid.querySelectorAll('button').forEach((x) => (x.disabled = true));
            b.classList.add('right');
            this.host.onEffect?.(`pick:${o.object}`);
            this.win(t(this.content, s.gloss), [obj.word], () => setTimeout(() => (s.end ? this.close(true) : this.advance()), 700));
          } else {
            if (entry) speak(this.content, entry.target, `w_${obj.word}`, RATE.WORD);
            b.classList.remove('wrong');
            void b.offsetWidth;
            b.classList.add('wrong');
            const right = options.find((x) => x.ok);
            if (right) this.confuse([obj.word], [this.scene.objects[right.object].word]);
            this.lose(t(this.content, o.why), o.errorType, [obj.word], grid);
          }
        };
        grid.appendChild(b);
      });
    body.appendChild(grid);
  }
}
