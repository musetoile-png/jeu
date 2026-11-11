/**
 * Lecteur de scènes : affiche les répliques en HTML par-dessus le canvas,
 * gère les choix, les « pick » (dictée-wok), la patience, l'audio et le journal.
 */
import { preloadVoices, RATE, speak, speakWords, stop } from './audio';
import type { Choice, Content, Pay, PickOption, Restore, Said, Scene, Sequence, Serve, Stall, StallGood, StallLine, Step, Ticket, Token } from './content';
import { lineText, lineWords, t } from './content';
import { log } from './log';
import * as notebook from './notebook';
import * as save from './save';
import type { TicketPicks } from './service';
import { addition, makeChange, moneyLine, moneyText, rightPicks, subtraction, ticketLine, total, withAmount, wrongCells } from './service';
import { play as sound } from './sfx';
import { explain, fillSlot, fmt, glossOf, imageOf, itemFor, planStall, shuffle, stallVoKey } from './stall';
import { cinematic, flyProvision, flyToBag, inkWord, toast } from './ui';

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

  /** Étal : 🔊 et 🐢 rejouent la réplique en cours (partie fixe + clip du mot) ; null = la réplique affichée. */
  private replay: ((rate: number) => void) | null = null;
  /** Étal : numéro de manche ; une voix enchaînée d'une manche passée ne continue pas dans la suivante. */
  private stallTurn = 0;

  /** Service : tickets remplis (par id), progression de chaque étape (pour reprendre après un détour), caisse. */
  private tickets = new Map<string, { ticket: Ticket; picks: TicketPicks }>();
  private progress = new Map<number, { k: number; order?: number[]; results?: boolean[] }>();
  private till = 0;
  /** Numéro d'étape affichée : une voix enchaînée d'un affichage passé (avant un détour…) ne continue pas. */
  private turn = 0;
  /** Objet posé à l'écran pendant la scène (la carte de Léo…). */
  private prop: HTMLElement | null = null;

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
        <span class="till" id="dlg-till" hidden></span>
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
    for (const id of ['portrait', 'who', 'whofr', 'pat', 'till', 'line', 'fr', 'slow', 'normal', 'words', 'sub', 'py', 'body', 'fb'])
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
    this.el.slow.onclick = () => (this.replay ? this.replay(RATE.SLOW) : this.sayLine(this.words, this.currentVo, RATE.SLOW));
    this.el.normal.onclick = () => (this.replay ? this.replay(RATE.NORMAL) : this.sayLine(this.words, this.currentVo, RATE.NORMAL));
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
      const top0 = Math.max(H * 0.05, below);
      this.bubble.style.left = `${Math.round(W * 0.03)}px`;
      this.bubble.style.top = `${Math.round(top0)}px`;
      this.bubble.classList.toggle('under', this.overPanel(W * 0.03, top0, bw, bh));
      return;
    }
    const hx = a.x * W;
    const left = Math.max(8, Math.min(W - bw - 8, hx - bw / 2));
    let top = Math.max(8, a.y * H - bh - 18);
    // jamais sur les réponses : si la bulle chevauche le panneau d'action, elle remonte au-dessus ;
    // sans la place, elle passe dessous (les réponses restent touchables, la bulle reste lisible à côté)
    if (this.overPanel(left, top, bw, bh)) top = Math.max(8, Math.min(top, this.root.getBoundingClientRect().top - stage.getBoundingClientRect().top - bh - 18));
    this.bubble.classList.toggle('under', this.overPanel(left, top, bw, bh));
    this.bubble.style.left = `${Math.round(left)}px`;
    this.bubble.style.top = `${Math.round(top)}px`;
    this.bubble.style.setProperty('--tail', `${Math.round(Math.max(22, Math.min(bw - 22, hx - left)))}px`);
    this.dodgeProp(stage, left, top, bw, bh);
  }

  /** La carte posée à l'écran laisse la place à la bulle : si elles se chevauchent, la carte passe de l'autre côté. */
  private dodgeProp(stage: HTMLElement, left: number, top: number, bw: number, bh: number) {
    const box = this.prop;
    if (!box || this.bubble.hidden) return;
    const st = stage.getBoundingClientRect();
    const area = (r: DOMRect) => {
      const w = Math.min(st.left + left + bw, r.right) - Math.max(st.left + left, r.left);
      const h = Math.min(st.top + top + bh, r.bottom) - Math.max(st.top + top, r.top);
      return w > 0 && h > 0 ? w * h : 0;
    };
    const here = area(box.getBoundingClientRect());
    if (!here) return;
    const right = box.classList.contains('side-right');
    // où serait la carte de l'autre côté : même largeur, posée en miroir
    const r = box.getBoundingClientRect();
    const dx = right ? st.left + (st.right - r.right) - r.left : st.right - (r.left - st.left) - r.right;
    const there = area(new DOMRect(r.left + dx, r.top, r.width, r.height));
    if (there < here) {
      box.classList.toggle('side-right', !right);
      box.classList.toggle('side-left', right);
    }
  }

  /** La bulle (position dans la scène, px) chevaucherait-elle le panneau d'action ? */
  private overPanel(left: number, top: number, bw: number, bh: number) {
    if (this.root.hidden) return false;
    const st = (this.bubble.parentElement as HTMLElement).getBoundingClientRect();
    const pr = this.root.getBoundingClientRect();
    return pr.width > 0 && st.left + left < pr.right && st.left + left + bw > pr.left && st.top + top < pr.bottom && st.top + top + bh > pr.top;
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
    this.setTill(0);
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
    this.showProp();
    this.step();
  }

  /** La carte (ou tout objet de la scène) reste sous les yeux : on la relit pendant les exercices. */
  private showProp() {
    this.prop?.remove();
    this.prop = null;
    const pr = this.scene.prop;
    if (!pr) return;
    const stage = document.getElementById('stage');
    if (!stage) return;
    const box = document.createElement('div');
    box.className = `prop side-${this.host.side ?? 'right'}`;
    const card = document.createElement('div');
    card.className = 'prop-card';
    const url = this.host.imageUrl(pr.image);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      card.append(img);
    } else card.classList.add('plain');
    if (pr.text) {
      const hand = document.createElement('span');
      hand.className = 'prop-hand';
      hand.lang = this.content.language.bcp47;
      hand.textContent = pr.text;
      card.append(hand);
    }
    box.append(card);
    if (pr.sheet) {
      const sheet = document.createElement('div');
      sheet.className = 'prop-sheet';
      sheet.lang = this.content.language.bcp47;
      sheet.textContent = pr.sheet.text;
      sheet.hidden = true;
      box.append(sheet);
    }
    stage.append(box);
    this.prop = box;
  }

  /** La copie au propre apparaît à l'étape prévue (et y reste). */
  private updateProp() {
    const sheet = this.prop?.querySelector<HTMLElement>('.prop-sheet');
    if (sheet && sheet.hidden && this.i >= (this.scene.prop?.sheet?.from ?? 0)) sheet.hidden = false;
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
    this.replay = null;
    this.stallTurn++;
    this.turn++;
    this.root.classList.remove('stall-mode', 'task-mode');
    document.body.classList.remove('talking');
    document.removeEventListener('keydown', this.keys);
    this.root.hidden = true;
    this.bubble.hidden = true;
    this.clearSheet();
    this.prop?.remove();
    this.prop = null;
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

  /** Caisse du service : montant affiché dans les outils ; `delta` fait monter un « +7 » ou un « −2 ». */
  private setTill(delta: number) {
    const tl = this.scene.till;
    this.el.till.hidden = !tl;
    if (!tl) return;
    this.till += delta;
    const unit = this.content.pack.money ? lineText(this.content, [this.content.pack.money.unit]) : '';
    this.el.till.textContent = fmt(this.content.ui.till ?? '{n} / {target}', { n: String(this.till), target: String(tl.target), unit });
    this.el.till.classList.toggle('neg', this.till < 0);
    if (!delta) return;
    const f = document.createElement('i');
    f.className = `till-float ${delta > 0 ? 'up' : 'down'}`;
    f.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
    this.el.till.appendChild(f);
    setTimeout(() => f.remove(), 1600);
    log({ scene: this.scene.id, step: this.i, kind: 'till', detail: `delta=${delta};till=${this.till}` });
  }

  /** Après `ms`, si l'on est toujours sur le même affichage (ni détour, ni étape suivante entre-temps). */
  private later(f: () => void, ms: number) {
    const t0 = this.turn;
    setTimeout(() => {
      if (this.live && t0 === this.turn) f();
    }, ms);
  }

  /** Une réplique dite d'une seule voix (clip entier), dans la bulle de celui qui parle. */
  private say(actor: string, l: Said, expression?: string, onEnd?: () => void, rate: number = RATE.NORMAL, meet = true) {
    this.setActor(actor, expression);
    this.showLine(l.line, t(this.content, l.gloss), meet);
    const t0 = this.turn;
    this.sayLine(l.line, l.vo, rate, () => {
      if (this.live && t0 === this.turn) onEnd?.();
    });
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

  /** `meet` : compter les mots au carnet avec cette ligne pour contexte (l'étal le fait lui-même, seulement sur une bonne réponse). */
  private showLine(raw: Token[], gloss: string, meet = true) {
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
    if (!meet) return;
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
    this.turn++;
    this.replay = null;
    if (!s) return this.close(true);
    this.updateProp();
    // étape réservée à une quête, à un nom… : sautée si elle ne concerne pas ce joueur
    if (s.when && !save.matches(s.when)) {
      if (s.end) this.close(true);
      else this.advance();
      return;
    }
    // les jeux du service prennent un panneau plus large (et, sur téléphone, sortent sous la scène)
    this.root.classList.toggle('task-mode', ['ticket', 'sequence', 'serve', 'pay'].includes(s.type));
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
    // une commande, une consigne à écouter : la bulle reste vide (……), la voix seule compte
    const hidden = (s.type === 'ticket' && s.ticket?.hidden !== false) || (s.type === 'sequence' && !!s.sequence?.hidden);
    if (s.line) {
      if (hidden) this.showLine(Dialogue.MASK, this.content.ui.heardOnly ?? '…', false);
      else this.showLine(s.line, t(this.content, s.gloss));
      this.sayLine(s.line, s.vo, RATE.NORMAL, autoEnd ? () => setTimeout(finish, readMs) : undefined);
    }
    // filet de sécurité : si la voix ne prévient pas de sa fin (son bloqué), on reprend quand même
    if (autoEnd) setTimeout(finish, (s.line ? 7000 : 0) + readMs);

    if (s.type === 'say') {
      this.exchange(s);
      if (s.wage) this.renderWage();
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
    if (s.type === 'stall' && s.stall) this.renderStall(s.stall);
    if (s.type === 'ticket' && s.ticket) this.renderTicket(s, s.ticket);
    if (s.type === 'sequence' && s.sequence) this.renderSequence(s, s.sequence);
    if (s.type === 'serve' && s.serve) this.renderServe(s, s.serve);
    if (s.type === 'pay' && s.pay) this.renderPay(s, s.pay);
  }

  /** Bulle d'une réplique qu'on doit entendre sans la lire. */
  private static readonly MASK: Token[] = [['t', '……', '', '']];

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
   * La réplique de retour (« 好了！来，做饭！ ») n'est dite que si celui qui envoie au détour est dans la scène
   * (奶奶, dans sa cuisine) : ailleurs, la scène reprend sans elle, là où elle s'était arrêtée.
   */
  private detour(d: NonNullable<Content['pack']['detours']>[string], refill: number) {
    // la bulle d'avant le détour : on la remet au retour (une étape sans réplique garde la question précédente)
    const before = { speaker: this.speaker, words: this.words, fr: this.el.fr.textContent ?? '', vo: this.currentVo, hidden: this.bubble.hidden };
    const resume = () => {
      if (!this.live) return;
      this.confusions = [];
      if (before.hidden) {
        this.bubble.hidden = true;
        this.words = before.words;
      } else {
        this.setActor(before.speaker || undefined);
        this.showLine(before.words, before.fr, false);
      }
      this.currentVo = before.vo;
      this.setPatience(Math.min(refill, this.scene.patience));
      this.step();
      this.setPatience(Math.min(refill, this.scene.patience));
    };
    this.turn++;
    this.replay = null;
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
        if (!this.scene.actors[d.actor]) {
          setTimeout(resume, 600);
          return;
        }
        this.showLine(d.back.line, t(this.content, d.back.gloss));
        this.sayLine(d.back.line, d.back.vo, RATE.NORMAL, () => setTimeout(resume, 400));
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

  // ---------- Service : ticket, étapes, plateaux, caisse ----------

  private div(cls: string, text?: string) {
    const d = document.createElement('div');
    d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  /** Bouton fait d'une ligne de mots ; un toucher choisit le bouton (les mots ne se jouent pas un à un ici). */
  private chip(line: Token[], cls: string) {
    const b = document.createElement('button');
    b.className = cls;
    for (const tok of save.resolveLine(this.content, line)) {
      const w = this.wordEl(tok);
      w.onclick = null;
      w.tabIndex = -1;
      b.appendChild(w);
    }
    return b;
  }

  /** Une ligne de mots affichée (ticket, ardoise), sans bouton. */
  private lineBox(line: Token[], cls: string) {
    const d = this.div(cls);
    for (const tok of save.resolveLine(this.content, line)) d.appendChild(this.wordEl(tok));
    return d;
  }

  private goButton(text: string, onClick: () => void) {
    this.el.body.querySelector(':scope > button.go')?.remove();
    const b = document.createElement('button');
    b.className = 'go';
    b.textContent = text;
    b.onclick = () => {
      sound('tap');
      b.remove();
      onClick();
    };
    this.el.body.appendChild(b);
    return b;
  }

  private next(s: Step) {
    if (s.end) this.close(true);
    else this.advance();
  }

  /** Les mots d'une ligne comptent au carnet, avec cette ligne pour contexte (commande servie, consigne retrouvée). */
  private meetLine(line: Token[]) {
    const ctx = lineText(this.content, save.resolveLine(this.content, line));
    for (const id of lineWords(line)) log({ scene: this.scene.id, step: this.i, kind: 'word_met', word: id, context: notebook.meet(id, ctx) });
    document.dispatchEvent(new CustomEvent('notebook-changed'));
  }

  /** Ticket rempli par le joueur ; sans ticket (scène commencée au milieu, pour un test), la bonne commande. */
  private ticketOf(id: string): { ticket: Ticket; picks: TicketPicks } | undefined {
    const got = this.tickets.get(id);
    if (got) return got;
    const tk = this.scene.steps.find((x) => x.ticket?.id === id)?.ticket;
    return tk ? { ticket: tk, picks: rightPicks(tk) } : undefined;
  }

  /** Le rival ricane (après la plainte d'un client mal servi, une monnaie fausse). */
  private mock(unless?: string, after?: () => void) {
    const m = this.scene.till?.mock;
    if (!m || m.actor === unless) return;
    this.say(m.actor, m, 'joy', () => this.later(() => after?.(), 500), RATE.NORMAL, false);
  }

  /** Une plainte : le client la dit, le rival ricane, puis la bulle revient à la plainte (elle reste lisible). */
  private complain(actor: string, l: Said) {
    const back = () => {
      this.setActor(actor, 'surprise');
      this.showLine(l.line, t(this.content, l.gloss), false);
    };
    this.say(actor, l, 'surprise', () => this.later(() => this.mock(actor, back), 300));
  }

  /**
   * Ticket de commande. Le client commande à voix haute (la bulle reste vide) ; le joueur coche, pour chaque élément,
   * une option par case (quantité + classificateur, plat, précision). « Attendez ! » fait répéter une seule fois.
   * Aucune correction ici : l'écoute du moment compte, l'erreur se découvrira au service.
   */
  private renderTicket(s: Step, tk: Ticket) {
    const c = this.content;
    const ui = c.ui;
    const actor = s.actor ?? this.scene.npc;
    const who = this.scene.actors[actor]?.name ?? '';
    const body = this.el.body;
    const ask = this.div('fr', t(c, s.ask) || fmt(ui.ticketAsk ?? '', { who }));
    const slip = this.div('tk-slip');
    slip.appendChild(this.div('tk-head', fmt(ui.ticketHead ?? '', { who })));
    const picks: (number | undefined)[][] = tk.items.map((it) => it.cells.map(() => undefined));
    const send = document.createElement('button');
    send.className = 'go';
    send.textContent = ui.ticketSend ?? '✓';
    send.disabled = true;
    tk.items.forEach((it, i) => {
      const row = this.div('tk-item');
      row.appendChild(this.div('tk-n', String(i + 1)));
      const cells = this.div('tk-cells');
      it.cells.forEach((cell, j) => {
        const opts = this.div('tk-cell');
        opts.dataset.kind = cell.kind ?? '';
        // l'ordre est mélangé : la position ne doit rien révéler
        for (const { o, k } of shuffle(cell.options.map((o, k) => ({ o, k })))) {
          const b = this.chip(o.line, 'tk-chip');
          b.onclick = () => {
            sound('tap');
            picks[i][j] = k;
            opts.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
            send.disabled = picks.some((r) => r.some((x) => x === undefined));
          };
          opts.appendChild(b);
        }
        cells.appendChild(opts);
      });
      row.appendChild(cells);
      slip.appendChild(row);
    });

    // « 等一下 ! » : le client répète une fois, en soupirant ; 🔊 et 🐢 passent par là aussi
    let waited = false;
    const wait = this.chip(tk.wait?.line ?? [], 'sm tk-wait');
    if (!tk.wait) wait.textContent = ui.ticketWait ?? '…';
    const again = (rate: number) => {
      if (waited || !tk.again) {
        this.feedback(fmt(ui.ticketOnce ?? '', { who }), '');
        return;
      }
      waited = true;
      wait.disabled = true;
      log({ scene: this.scene.id, step: this.i, kind: 'retry', detail: `ticket=${tk.id};wait;rate=${rate}` });
      const l = tk.again;
      const repeat = () => {
        this.setActor(actor, 'surprise');
        this.showLine(tk.hidden === false ? l.line : Dialogue.MASK, t(c, l.gloss), false);
        this.sayLine(l.line, l.vo, rate);
      };
      if (tk.wait) this.say('player', tk.wait, undefined, () => this.later(repeat, 250));
      else repeat();
    };
    this.replay = again;
    wait.onclick = () => again(RATE.NORMAL);

    send.onclick = () => {
      const p = picks.map((r) => r.map((x) => x ?? 0));
      this.tickets.set(tk.id, { ticket: tk, picks: p });
      slip.querySelectorAll('button').forEach((x) => (x.disabled = true));
      wait.disabled = true;
      send.disabled = true;
      // chaque case est journalisée tout de suite (matrice de confusion) ; la correction viendra au service
      tk.items.forEach((it, i) =>
        it.cells.forEach((cell, j) => {
          const o = cell.options[p[i][j]];
          const right = cell.options.find((x) => x.ok);
          log({
            scene: this.scene.id,
            step: this.i,
            kind: 'answer',
            ok: !!o.ok,
            word: lineWords(right?.line ?? [])[0],
            detail: `ticket=${tk.id};item=${i + 1};cell=${cell.kind ?? j + 1};answer=${lineText(c, o.line)};expected=${lineText(c, right?.line ?? [])}${o.ok ? '' : `;errorType=${o.errorType ?? '?'}`};waited=${waited ? 1 : 0}`,
          });
        }),
      );
      sound('page');
      this.replay = () => undefined;
      this.feedback(ui.ticketSent ?? '', '');
      this.later(() => this.next(s), 1100);
    };
    const row = this.div('tk-actions');
    row.append(wait, send);
    body.append(ask, slip, row);
  }

  /**
   * Cartes d'étapes à remettre dans l'ordre de la consigne (先…再…然后…). Chaque toucher est vérifié :
   * une carte posée trop tôt coûte de la patience, l'explication nomme le mot d'ordre, la bonne carte est montrée.
   */
  private renderSequence(s: Step, sq: Sequence) {
    const c = this.content;
    const ui = c.ui;
    const actor = s.actor ?? this.scene.npc;
    const who = this.scene.actors[actor]?.name ?? '';
    const n = sq.cards.length;
    // un ordre mélangé qui n'est pas déjà le bon ; gardé si l'on revient d'un détour
    let order = shuffle(sq.cards.map((_, k) => k));
    if (order.every((x, k) => x === k)) order = [...order.slice(1), order[0]];
    const st = this.progress.get(this.i) ?? { k: 0, order };
    this.progress.set(this.i, st);
    const ask = this.div('fr', t(c, s.ask) || fmt(ui.seqAsk ?? '', { who }));
    const slots = this.div('seq-slots');
    const pool = this.div('picks seq-pool');
    const boxes = sq.cards.map((card, k) => {
      const box = this.div(`seq-slot${k < st.k ? ' filled' : ''}`);
      box.appendChild(this.div('seq-num', String(k + 1)));
      if (k < st.k) box.appendChild(this.lineBox(card.line, 'seq-words'));
      slots.appendChild(box);
      return box;
    });
    this.el.body.append(ask, slots, pool);
    let revealed = !sq.hidden;
    const reveal = () => {
      if (revealed || !s.line) return;
      revealed = true;
      this.setActor(actor);
      this.showLine(s.line, t(c, s.gloss));
    };
    // la consigne se réécoute autant qu'on veut : c'est l'ordre qu'il faut retenir
    if (s.line) this.replay = (rate) => this.sayLine(s.line!, s.vo, rate);
    const done = () => {
      reveal();
      log({ scene: this.scene.id, step: this.i, kind: 'answer', ok: true, detail: 'sequence=complete' });
      this.goButton(s.end ? ui.finish : ui.continue, () => this.next(s));
    };
    if (st.k >= n) {
      done();
      return;
    }
    for (const idx of st.order ?? []) {
      if (idx < st.k) continue;
      const card = sq.cards[idx];
      const b = this.chip(card.line, 'seq-card');
      b.dataset.idx = String(idx);
      b.onclick = () => {
        const expected = sq.cards[st.k];
        const ok = idx === st.k;
        log({
          scene: this.scene.id,
          step: this.i,
          kind: 'answer',
          ok,
          word: lineWords(expected.line)[0],
          detail: `sequence=${st.k + 1};answer=${lineText(c, card.line)};expected=${lineText(c, expected.line)}${ok ? '' : ';errorType=sequence'}`,
        });
        pool.querySelectorAll('.show-answer').forEach((x) => x.classList.remove('show-answer'));
        if (ok) {
          b.remove();
          boxes[st.k].classList.add('filled');
          boxes[st.k].appendChild(this.lineBox(card.line, 'seq-words'));
          st.k++;
          this.win(lineText(c, card.line), lineWords(card.line), () => (st.k >= n ? done() : undefined));
        } else {
          b.classList.remove('wrong');
          void b.offsetWidth;
          b.classList.add('wrong');
          this.confuse(lineWords(card.line), lineWords(expected.line));
          reveal();
          pool.querySelector<HTMLElement>(`[data-idx="${st.k}"]`)?.classList.add('show-answer');
          this.lose(t(c, expected.why), 'sequence', lineWords(expected.line), pool);
        }
      };
      pool.appendChild(b);
    }
  }

  /**
   * Service : les plateaux (ce que le joueur a écrit sur les tickets) arrivent un à un, dans le désordre ;
   * on porte chacun à une place, désignée par ce que le client a dit (这儿, 那儿…). Bon plateau, bonne place : merci.
   * Sinon le client se plaint (sa propre voix), la bulle oppose ce qui est servi à ce qui était commandé,
   * la caisse perd le plat refait, le rival ricane, la bonne place est montrée ; on passe au plateau suivant.
   */
  private renderServe(s: Step, sv: Serve) {
    const c = this.content;
    const ui = c.ui;
    const places = sv.places.filter((p) => this.ticketOf(p.ticket));
    let order = shuffle(places.map((_, k) => k));
    const st = this.progress.get(this.i) ?? { k: 0, order };
    this.progress.set(this.i, st);
    order = st.order ?? order;
    const head = this.div('stall-head');
    const tag = Object.assign(document.createElement('span'), { className: 'stall-tag' });
    const pips = this.div('stall-pips');
    order.forEach(() => pips.appendChild(document.createElement('i')));
    head.append(tag, pips);
    const ask = this.div('fr');
    const tray = this.div('tk-slip tray');
    const row = this.div('serve-places');
    this.el.body.append(head, ask, tray, row);
    const results = (st.results ??= []);
    results.forEach((r, j) => pips.children[j]?.classList.add(r ? 'ok' : 'ko'));

    const show = () => {
      tray.innerHTML = '';
      row.innerHTML = '';
      this.feedback('', '');
      if (st.k >= order.length) {
        tag.textContent = '';
        ask.textContent = ui.serveDone ?? '';
        tray.remove();
        this.goButton(s.end ? ui.finish : ui.continue, () => this.next(s));
        return;
      }
      const want = places[order[st.k]];
      const T = this.ticketOf(want.ticket)!;
      [...pips.children].forEach((p, j) => p.classList.toggle('on', j === st.k));
      tag.textContent = fmt(ui.serveTray ?? '{k}/{n}', { k: String(st.k + 1), n: String(order.length) });
      ask.textContent = t(c, s.ask) || (ui.serveAsk ?? '');
      tray.appendChild(this.div('tk-head', ui.serveTrayHead ?? ''));
      tray.appendChild(this.lineBox(ticketLine(T.ticket, T.picks), 'tk-line'));
      const buttons = places.map((p) => {
        const b = document.createElement('button');
        b.className = 'serve-place';
        b.appendChild(this.lineBox(p.line, 'tk-line'));
        if (p === want) b.dataset.ok = '1';
        if (p.caption) b.appendChild(this.div('cap', t(c, p.caption)));
        b.onclick = () => serve(p, b, want, T, buttons);
        row.appendChild(b);
        return b;
      });
    };

    const serve = (p: Serve['places'][number], b: HTMLButtonElement, want: Serve['places'][number], T: { ticket: Ticket; picks: TicketPicks }, buttons: HTMLButtonElement[]) => {
      buttons.forEach((x) => (x.disabled = true));
      const okPlace = p === want;
      const bad = wrongCells(T.ticket, T.picks);
      const right = ticketLine(T.ticket, rightPicks(T.ticket));
      log({
        scene: this.scene.id,
        step: this.i,
        kind: 'answer',
        ok: okPlace,
        word: lineWords(want.line)[0],
        detail: `serve=${want.ticket};place=${lineText(c, p.line)};expected=${lineText(c, want.line)}${okPlace ? '' : ';errorType=semantic'};ticketErrors=${bad.length}`,
      });
      st.k++;
      // ce que le client voulait (la commande juste) entre au carnet, avec la commande pour contexte
      this.meetLine(right);
      if (okPlace && !bad.length) {
        results.push(true);
        pips.children[st.k - 1]?.classList.add('ok');
        b.classList.add('right');
        const words = [...lineWords(right), ...lineWords(want.line)];
        let gone = false;
        const nextTray = () => {
          if (gone) return;
          gone = true;
          show();
        };
        this.win(lineText(c, right), words, () => this.say(want.actor, want.thanks, 'joy', () => this.later(nextTray, 500)));
        // filet : si la voix ne prévient pas de sa fin, le plateau suivant arrive quand même
        this.later(nextTray, 7000);
        return;
      }
      results.push(false);
      pips.children[st.k - 1]?.classList.add('ko');
      b.classList.add('wrong');
      buttons[places.indexOf(want)]?.classList.add('show-answer');
      // qui se plaint, et de quoi : le client servi à tort réclame sa propre commande
      const R = this.ticketOf(p.ticket)!;
      const [bi, bj] = bad[0] ?? [0, 0];
      const complaint = !okPlace ? R.ticket.items[0].complaint : (T.ticket.items[bi].cells[bj].complaint ?? T.ticket.items[bi].complaint);
      // la bulle oppose ce qui est servi à ce qui était commandé
      const oppose = this.div('oppose');
      oppose.append(this.div('lbl', ui.serveServed ?? '✗'), this.lineBox(ticketLine(T.ticket, T.picks), 'tk-line served'));
      oppose.append(this.div('lbl', fmt(ui.serveWanted ?? '✓', { who: this.scene.actors[p.actor]?.name ?? '' })), this.lineBox(ticketLine(R.ticket, rightPicks(R.ticket)), 'tk-line wanted'));
      tray.appendChild(oppose);
      const whys = [okPlace ? '' : t(c, want.why), ...bad.map(([i, j]) => t(c, T.ticket.items[i].cells[j].options[T.picks[i][j]].why))].filter(Boolean);
      const expected: string[] = [];
      for (const [i, j] of bad) {
        const cell = T.ticket.items[i].cells[j];
        const rightOpt = cell.options.find((o) => o.ok);
        this.confuse(lineWords(cell.options[T.picks[i][j]].line), lineWords(rightOpt?.line ?? []));
        expected.push(...lineWords(rightOpt?.line ?? []));
      }
      if (!okPlace) {
        this.confuse(lineWords(p.line), lineWords(want.line));
        expected.push(...lineWords(want.line));
      }
      const errorType = !okPlace ? 'semantic' : (T.ticket.items[bi].cells[bj].options[T.picks[bi][bj]].errorType ?? '?');
      this.setTill(-(sv.penalty ?? 0));
      this.lose(whys.join(' '), errorType, expected, row);
      this.complain(p.actor, complaint);
      this.goButton(ui.continue, show);
    };
    show();
  }

  /** Pièce ou billet (chiffre et montant dit). */
  private piece(v: number) {
    const coins = this.content.pack.money?.coins ?? [];
    const d = this.div(`piece ${coins.length && v === Math.min(...coins) ? 'coin' : 'note'}`);
    d.dataset.v = String(v);
    d.append(Object.assign(document.createElement('b'), { textContent: String(v) }), Object.assign(document.createElement('small'), { textContent: moneyText(this.content, v) }));
    return d;
  }

  /**
   * Encaissement : l'ardoise des prix et la commande ; le client demande « combien ? », le joueur choisit le total ;
   * puis le client tend un billet et le joueur compose la monnaie (pièces et billets du pack).
   * Erreur : l'addition ou la soustraction, en mots et en chiffres ; une monnaie trop généreuse fait baisser la caisse.
   */
  private renderPay(s: Step, py: Pay) {
    const c = this.content;
    const ui = c.ui;
    const actor = s.actor ?? this.scene.npc;
    const who = this.scene.actors[actor]?.name ?? '';
    const T = this.ticketOf(py.ticket);
    if (!T) {
      this.next(s);
      return;
    }
    const sum = total(T.ticket);
    const due = py.given.n - sum;
    const st = this.progress.get(this.i) ?? { k: 0 };
    this.progress.set(this.i, st);
    const coins = c.pack.money?.coins ?? [1, 5, 10];
    const body = this.el.body;
    // l'ardoise (prix) et la commande de ce client
    const board = this.div('pay-board');
    const slate = this.scene.till?.slate;
    if (slate?.length) {
      const sl = this.div('slate');
      for (const l of slate) sl.appendChild(this.lineBox(l, 'slate-line'));
      board.appendChild(sl);
    }
    const slip = this.div('tk-slip pay-order');
    slip.append(this.div('tk-head', fmt(ui.payOrder ?? '', { who })), this.lineBox(ticketLine(T.ticket, rightPicks(T.ticket)), 'tk-line'));
    board.appendChild(slip);
    const ask = this.div('fr');
    const area = this.div('pay-area');
    body.append(board, ask, area);

    const stageTotal = () => {
      ask.textContent = ui.payTotalAsk ?? '';
      this.say(actor, py.ask);
      const choices = this.div('choices pay-totals');
      for (const o of shuffle(py.totals)) {
        const said = withAmount(c, py.total, o.n);
        const b = this.chip(said.line, '');
        if (o.n === sum) b.dataset.ok = '1';
        b.onclick = () => {
          choices.querySelectorAll('button').forEach((x) => (x.disabled = true));
          const ok = o.n === sum;
          log({ scene: this.scene.id, step: this.i, kind: 'answer', ok, word: lineWords(moneyLine(c, sum))[0], detail: `pay=${py.ticket};total;answer=${o.n};expected=${sum}${ok ? '' : `;errorType=${o.errorType ?? 'number'}`}` });
          st.k = 1;
          if (ok) {
            b.classList.add('right');
            this.win(addition(c, T.ticket), lineWords(said.line), () => this.say('player', said, undefined, () => this.later(stageChange, 300)));
          } else {
            b.classList.add('wrong');
            this.confuse(lineWords(said.line), lineWords(moneyLine(c, sum)));
            this.lose(`${addition(c, T.ticket)} ${t(c, o.why)}`.trim(), o.errorType ?? 'number', lineWords(moneyLine(c, sum)), choices);
            choices.querySelector('[data-ok="1"]')?.classList.add('show-answer');
            this.say('player', said);
            this.goButton(ui.continue, stageChange);
          }
        };
        choices.appendChild(b);
      }
      area.appendChild(choices);
    };

    const stageChange = () => {
      area.innerHTML = '';
      // le total est dit : l'ardoise se range, il reste à rendre la monnaie
      board.remove();
      area.appendChild(this.div('lbl pay-due', fmt(ui.payDue ?? '{words}', { words: moneyText(c, sum), n: String(sum) })));
      this.feedback('', '');
      ask.textContent = fmt(ui.payChangeAsk ?? '', { who, paid: moneyText(c, py.given.n) });
      this.say(actor, py.given);
      const given = this.div('pay-given');
      given.append(this.div('lbl', fmt(ui.payGiven ?? '', { who })), this.piece(py.given.n));
      const trayLbl = this.div('lbl');
      const tray = this.div('pay-tray');
      const palette = this.div('pay-coins');
      const chosen: number[] = [];
      const send = document.createElement('button');
      send.className = 'go';
      send.textContent = ui.paySend ?? '✓';
      const draw = () => {
        tray.innerHTML = '';
        chosen.forEach((v, k) => {
          const p = this.piece(v);
          p.onclick = () => {
            if (send.disabled && chosen.length) return;
            chosen.splice(k, 1);
            sound('tap');
            draw();
          };
          tray.appendChild(p);
        });
        const n = chosen.reduce((a, b) => a + b, 0);
        trayLbl.textContent = fmt(ui.payTray ?? '{n}', { n: String(n), words: n ? moneyText(c, n) : '' });
        send.disabled = !chosen.length;
      };
      for (const v of coins) {
        const b = document.createElement('button');
        b.className = 'coin-btn';
        b.appendChild(this.piece(v));
        b.onclick = () => {
          sound('tap');
          chosen.push(v);
          draw();
        };
        palette.appendChild(b);
      }
      send.onclick = () => {
        const giv = chosen.reduce((a, b) => a + b, 0);
        palette.querySelectorAll('button').forEach((x) => (x.disabled = true));
        send.disabled = true;
        const ok = giv === due;
        log({ scene: this.scene.id, step: this.i, kind: 'answer', ok, word: lineWords(moneyLine(c, due))[0], detail: `pay=${py.ticket};change;given=${py.given.n};total=${sum};answer=${giv};expected=${due}${ok ? '' : ';errorType=number'}` });
        st.k = 2;
        const back = withAmount(c, py.change, due);
        if (ok) {
          this.setTill(sum);
          this.win(subtraction(c, py.given.n, sum), lineWords(back.line), () =>
            this.say('player', back, undefined, () => this.later(() => this.say(actor, py.thanks, 'joy', () => this.later(() => this.next(s), 700)), 250)),
          );
          this.goButton(s.end ? ui.finish : ui.continue, () => this.next(s));
          return;
        }
        // trop rendu : la caisse perd la différence ; pas assez : le client réclame, on complète
        this.setTill(sum - Math.max(0, giv - due));
        this.confuse(lineWords(moneyLine(c, giv)), lineWords(moneyLine(c, due)));
        // la bonne monnaie est montrée
        area.appendChild(this.div('lbl', ui.payRight ?? ''));
        const show = this.div('pay-tray answer');
        for (const v of makeChange(due, coins)) show.appendChild(this.piece(v));
        show.dataset.ok = '1';
        area.appendChild(show);
        this.lose(`${subtraction(c, py.given.n, sum)} ${giv > due ? (ui.payOver ?? '') : (ui.payShort ?? '')}`.trim(), 'number', lineWords(moneyLine(c, due)), area);
        show.classList.add('show-answer');
        this.complain(actor, py.wrong);
        this.goButton(s.end ? ui.finish : ui.continue, () => this.next(s));
      };
      area.append(given, palette, trayLbl, tray);
      body.appendChild(send);
      draw();
    };

    if (st.k === 0) stageTotal();
    else if (st.k === 1) stageChange();
    else this.goButton(s.end ? ui.finish : ui.continue, () => this.next(s));
  }

  /** Bilan du service : la caisse, la paie (l'argent rejoint le sac). */
  private renderWage() {
    const c = this.content;
    const tl = this.scene.till;
    if (!tl) return;
    const w = tl.wage;
    const pay = w ? Math.max(w.min, w.base - Math.max(0, tl.target - this.till)) : 0;
    const unit = c.pack.money ? lineText(c, [c.pack.money.unit]) : '';
    this.el.body.appendChild(this.div('wage', fmt(c.ui.wageSummary ?? '', { till: String(this.till), target: String(tl.target), wage: String(pay), unit })));
    log({ scene: this.scene.id, step: this.i, kind: 'till', detail: `summary;till=${this.till};target=${tl.target};wage=${pay}` });
    if (!w || pay <= 0) return;
    if (w.flag) save.setFlags({ [w.flag]: String(pay) });
    const item = c.pack.money?.item;
    if (!item) return;
    save.addItem(item);
    flyToBag(c, item, this.host.anchor?.(this.scene.npc) ?? undefined);
    const it = c.items.get(item);
    if (it) toast(c, it.word, fmt(c.ui.wageToast ?? '+{n}', { n: String(pay), unit }));
    log({ scene: this.scene.id, step: this.i, kind: 'item_get', detail: `${item}+${pay}`, word: it?.word });
  }

  // ---------- Étal libre : jeu de vocabulaire rejouable ----------

  /** Réplique d'étal dans la bulle ; `word` null = l'article est caché (on doit l'entendre). Rien n'est compté au carnet ici. */
  private stallShow(actor: string, l: StallLine, word: string | null, expression?: string) {
    this.setActor(actor, expression);
    const mask: Token = ['t', '……', '', ''];
    this.showLine(fillSlot(l.line, word ? ['w', word] : mask), glossOf(this.content, l.gloss, word), false);
  }

  /**
   * Dit une réplique d'étal d'une seule voix : chaque combinaison « réplique + article » a son propre clip
   * (`cst_02_huacha`, `st_woyao_huacha_f`), pour ne jamais changer de voix au milieu d'une phrase.
   * Sans article, le clip de la réplique (`cst_05`). Un clip manquant passe par la synthèse, phrase entière.
   */
  private stallSpeak(l: StallLine, word: string | null, rate: number, onEnd?: () => void) {
    const c = this.content;
    const turn = this.stallTurn;
    const hasSlot = l.line.some((x) => x[0] === 'v' && x[1] === 'WORD');
    const withWord = Boolean(word && hasSlot && c.lexicon.get(word));
    const line = withWord ? fillSlot(l.line, ['w', word!]) : l.line.filter((x) => !(x[0] === 'v' && x[1] === 'WORD'));
    const text = lineText(c, save.resolveLine(c, line));
    const tpl = l.vo ? (withWord ? stallVoKey(l.vo, word!) : l.vo) : undefined;
    const vo = tpl ? save.fill(tpl, c) : undefined;
    this.currentVo = vo;
    speak(c, text, vo, rate, () => {
      if (this.live && turn === this.stallTurn) onEnd?.();
    });
  }

  /** Un article sur l'étal : son image, ou une étiquette de marché peinte (le caractère à l'encre sur un carton). */
  private stallCard(g: StallGood, url: string | undefined) {
    const b = document.createElement('button');
    b.className = 'pick stall-good';
    b.dataset.word = g.word;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      b.appendChild(img);
    } else {
      const target = this.content.lexicon.get(g.word)?.target ?? '?';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = target;
      tag.style.setProperty('--n', String([...target].length));
      b.classList.add('label');
      b.appendChild(tag);
    }
    return b;
  }

  /**
   * Étal libre. Une partie = quelques manches courtes, tirées en privilégiant les mots fragiles du carnet :
   * 听 écouter (toucher l'article entendu), 读 lire (toucher l'article écrit, sans son ni pinyin),
   * 说 dire (nommer l'article montré, parmi des mots aux mêmes caractères), 买 acheter (une fois, à la fin).
   * Erreur : explication qui nomme la confusion, patience qui baisse, la bonne réponse est montrée ; on ne recommence jamais.
   */
  private renderStall(st0: Stall) {
    const c = this.content;
    const ui = c.ui;
    const L = st0.lines;
    // un mode sans sa réplique n'est pas jouable
    const st: Stall = { ...st0, modes: (st0.modes ?? ['listen', 'read', 'say']).filter((m) => (m !== 'say' || !!L.ask) && (m !== 'buy' || !!L.want)) };
    const npc = this.scene.npc;
    const who = this.scene.actors[npc]?.name ?? '';
    const label = t(c, st.context) || this.scene.id;
    const pic = (g: StallGood) => {
      const key = imageOf(c, g, (k) => !!this.host.imageUrl(k));
      return key ? this.host.imageUrl(key) : undefined;
    };
    const ctxOf = (l: StallLine, word: string) => `${label} · ${lineText(c, save.resolveLine(c, fillSlot(l.line, ['w', word])))}`;
    const rounds = planStall(c, st, (g) => !!pic(g), (w) => !L.want || !notebook.hasContext(w, ctxOf(L.want, w)));
    preloadVoices(
      c,
      [L.open, ...L.offer, L.ask, L.want, L.sold, L.broke, L.bye].map((l) => (l?.vo ? save.fill(l.vo, c) : undefined)),
    );
    log({ scene: this.scene.id, step: 0, kind: 'stall', detail: `plan=${rounds.map((r) => `${r.mode}:${r.good.word}`).join(',')}` });

    this.root.classList.add('stall-mode');
    const body = this.el.body;
    const div = (cls: string) => Object.assign(document.createElement('div'), { className: cls });
    const head = div('stall-head');
    const tag = Object.assign(document.createElement('span'), { className: 'stall-tag' });
    const pips = div('stall-pips');
    rounds.forEach(() => pips.appendChild(document.createElement('i')));
    head.append(tag, pips);
    const ask = div('fr stall-ask');
    const prompt = div('stall-prompt');
    const board = div('picks stall-board');
    const answers = div('choices stall-words');
    body.append(head, ask, prompt, board, answers);

    const results: { word: string; ok: boolean; fresh: boolean }[] = [];
    // la phrase du commerçant varie : de préférence une phrase où ce mot n'a pas encore été reconnu
    const offerFor = (word: string) => {
      const fresh = L.offer.filter((o) => !notebook.hasContext(word, ctxOf(o, word)));
      const pool = fresh.length ? fresh : L.offer;
      return pool[Math.floor(Math.random() * pool.length)];
    };
    const meet = (word: string, ctx: string) => {
      const status = notebook.meet(word, ctx);
      log({ scene: this.scene.id, step: k, kind: 'word_met', word, context: status, detail: ctx });
      document.dispatchEvent(new CustomEvent('notebook-changed'));
    };
    const rightGloss = (word: string) => {
      const e = c.lexicon.get(word);
      return `${e?.target ?? word} ${e?.transcription ?? ''} : ${t(c, e?.gloss)}`;
    };
    const go = (text: string, onClick: () => void) => {
      body.querySelector(':scope > button.go')?.remove();
      const b = document.createElement('button');
      b.className = 'go';
      b.textContent = text;
      b.onclick = () => {
        sound('tap');
        b.remove();
        onClick();
      };
      body.appendChild(b);
    };

    let k = 0;
    const next = () => {
      k++;
      round();
    };

    const round = () => {
      this.stallTurn++;
      const turn = this.stallTurn;
      const later = (f: () => void, ms: number) =>
        setTimeout(() => {
          if (this.live && turn === this.stallTurn) f();
        }, ms);
      body.querySelector(':scope > button.go')?.remove();
      this.feedback('', '');
      prompt.innerHTML = '';
      board.innerHTML = '';
      answers.innerHTML = '';
      this.replay = null;
      const r = rounds[k] as (typeof rounds)[number] | undefined;
      if (!r) {
        finish();
        return;
      }
      [...pips.children].forEach((p, j) => p.classList.toggle('on', j === k));
      const word = r.good.word;
      const entry = c.lexicon.get(word);
      tag.textContent = ui[`stallMode_${r.mode}`] ?? r.mode;
      tag.dataset.mode = r.mode;
      ask.textContent = fmt(ui[`stallAsk_${r.mode === 'listen' && r.fresh ? 'listenNew' : r.mode}`] ?? '', { who });
      const cards = new Map<string, HTMLButtonElement>();
      for (const g of r.board) {
        const b = this.stallCard(g, pic(g));
        if (g.word === word) b.dataset.ok = '1';
        cards.set(g.word, b);
        board.appendChild(b);
      }
      board.dataset.n = String(r.board.length);

      const settle = (ok: boolean, chosen: string, errorType?: string) => {
        results.push({ word, ok, fresh: r.fresh });
        pips.children[k]?.classList.add(ok ? 'ok' : 'ko');
        log({
          scene: this.scene.id,
          step: k,
          kind: 'stall',
          word,
          ok,
          detail: `round=${k + 1};mode=${r.mode};answer=${chosen}${errorType ? `;error=${errorType}` : ''};fresh=${r.fresh ? 1 : 0}`,
        });
      };
      // erreur : explication, patience, le bon article montré ; la manche continue sur un bouton (le temps de lire)
      const fail = (chosen: string, container: HTMLElement, reveal: () => void, then: () => void) => {
        const { why, errorType } = explain(c, word, chosen);
        settle(false, chosen, errorType);
        this.lose(why, errorType, [word], container);
        container.querySelectorAll<HTMLElement>('[data-ok="1"]').forEach((x) => x.classList.add('show-answer'));
        const said = c.lexicon.get(chosen);
        // on entend d'abord ce qu'on a choisi, puis le commerçant redonne le bon mot
        if (said && r.mode !== 'buy') speak(c, said.target, `w_${chosen}`, RATE.WORD, () => later(reveal, 350));
        else later(reveal, 700);
        go(ui.continue, then);
      };

      // ----- 听 écouter / 读 lire : toucher le bon article -----
      if (r.mode === 'listen' || r.mode === 'read') {
        const tpl = offerFor(word);
        if (r.mode === 'listen') {
          this.stallShow(npc, tpl, null);
          const play = (rate: number) => {
            log({ scene: this.scene.id, step: k, kind: 'listen', word, detail: `stall:rate=${rate}` });
            this.stallSpeak(tpl, word, rate);
          };
          this.replay = play;
          const again = document.createElement('button');
          again.className = 'sm';
          again.textContent = ui.stallListen ?? '🔊';
          again.onclick = () => play(RATE.NORMAL);
          prompt.appendChild(again);
          later(() => play(RATE.NORMAL), 250);
        } else {
          // le papier : le mot écrit, sans son ni pinyin
          this.bubble.hidden = true;
          this.replay = () => undefined;
          const slip = div('stall-slip');
          slip.append(Object.assign(document.createElement('small'), { textContent: ui.stallSlip ?? '' }), Object.assign(document.createElement('b'), { textContent: entry?.target ?? word }));
          prompt.appendChild(slip);
        }
        for (const [w, b] of cards) {
          b.onclick = () => {
            board.querySelectorAll('button').forEach((x) => (x.disabled = true));
            prompt.querySelectorAll('button').forEach((x) => (x.disabled = true));
            if (w === word) {
              b.classList.add('right');
              settle(true, w);
              this.stallShow(npc, tpl, word, 'joy');
              meet(word, ctxOf(tpl, word));
              this.win(rightGloss(word), [word], () => this.stallSpeak(tpl, word, RATE.NORMAL, () => later(next, 600)));
            } else {
              b.classList.remove('wrong');
              void b.offsetWidth;
              b.classList.add('wrong');
              fail(w, board, () => {
                this.stallShow(npc, tpl, word);
                this.stallSpeak(tpl, word, RATE.NORMAL);
              }, next);
            }
          };
        }
        return;
      }

      // ----- 说 dire / 买 acheter : le commerçant montre un article, on choisit le mot -----
      board.querySelectorAll('button').forEach((x) => (x.disabled = true));
      cards.get(word)?.classList.add('shown');
      if (r.mode === 'say' && L.ask) {
        const l = L.ask;
        this.stallShow(npc, l, null);
        this.replay = (rate) => this.stallSpeak(l, null, rate);
        later(() => this.stallSpeak(l, null, RATE.NORMAL), 250);
      } else {
        this.bubble.hidden = true;
        this.replay = () => undefined;
      }
      const want = L.want;
      const purchase = () => {
        answers.hidden = true;
        const price = r.good.price ?? [];
        const pay = () => {
          const rich = !st.money || save.hasItem(st.money);
          if (rich) {
            this.host.onEffect?.('pay');
            if (L.sold) {
              this.stallShow(npc, L.sold, null, 'joy');
              this.stallSpeak(L.sold, null, RATE.NORMAL);
            }
            const from = this.host.anchor?.(npc) ?? undefined;
            const item = itemFor(c, r.good);
            if (item) {
              if (!save.hasItem(item.id)) {
                save.addItem(item.id);
                log({ scene: this.scene.id, step: k, kind: 'item_get', detail: item.id, word: item.word });
              }
              flyToBag(c, item.id, from);
            } else flyProvision(c, word, pic(r.good), from);
            toast(c, word, `${ui.stallProvision ?? ui.received ?? '+'} ${t(c, entry?.gloss)}`);
          } else if (L.broke) {
            this.stallShow(npc, L.broke, null);
            this.stallSpeak(L.broke, null, RATE.NORMAL);
          }
          log({ scene: this.scene.id, step: k, kind: 'stall', word, detail: `buy=${rich ? 'paid' : 'broke'};price=${r.good.cost ?? ''}` });
          go(ui.continue, next);
        };
        if (price.length) {
          this.setActor(npc);
          this.showLine([...price, ['p', '。']], fmt(ui.stallPrice ?? '{n}', { n: String(r.good.cost ?? '') }), false);
          // le prix, d'une seule voix : clip `<préfixe du commerçant>_prix_<mot>` (« 三十块。 »)
          const prefix = (L.sold?.vo ?? L.open?.vo ?? '').split('_')[0];
          const priceLine: Token[] = [...price, ['p', '。']];
          const turn = this.stallTurn;
          speak(c, lineText(c, priceLine), prefix ? `${prefix}_prix_${word}` : undefined, RATE.NORMAL, () => {
            if (this.live && turn === this.stallTurn) later(pay, 400);
          });
        } else pay();
      };

      for (const w of r.words) {
        const b = document.createElement('button');
        if (w === word) b.dataset.ok = '1';
        const shown = r.mode === 'buy' && want ? fillSlot(want.line, ['w', w]) : ([['w', w]] as Token[]);
        save.resolveLine(c, shown).forEach((tok) => b.appendChild(this.wordEl(tok)));
        b.onclick = () => {
          answers.querySelectorAll('button').forEach((x) => (x.disabled = true));
          if (w === word) {
            b.classList.add('right');
            settle(true, w);
            this.setActor('player');
            if (r.mode === 'buy' && want) {
              this.showLine(fillSlot(want.line, ['w', word]), glossOf(c, want.gloss, word), false);
              meet(word, ctxOf(want, word));
              this.win(rightGloss(word), [word], () => this.stallSpeak(want, word, RATE.NORMAL, () => later(purchase, 300)));
            } else {
              this.showLine([['w', word], ['p', '。']], t(c, entry?.gloss), false);
              meet(word, `${label} · ${L.ask ? lineText(c, save.resolveLine(c, L.ask.line)) : ''}${entry?.target ?? word}。`);
              this.win(rightGloss(word), [word], () => {
                if (entry) speak(c, entry.target, `w_${word}`, RATE.WORD, () => later(next, 700));
                else later(next, 700);
              });
            }
          } else {
            b.classList.remove('wrong');
            void b.offsetWidth;
            b.classList.add('wrong');
            if (r.mode === 'buy' && want) {
              // on entend la demande fautive (dans la bulle du joueur), la bonne est montrée ; l'achat continue avec le bon mot
              fail(w, answers, () => undefined, purchase);
              this.setActor('player');
              this.showLine(fillSlot(want.line, ['w', w]), glossOf(c, want.gloss, w), false);
              this.stallSpeak(want, w, RATE.NORMAL);
            } else {
              const tpl = L.offer[0];
              fail(w, answers, () => {
                this.stallShow(npc, tpl, word);
                this.stallSpeak(tpl, word, RATE.NORMAL);
              }, next);
            }
          }
        };
        answers.appendChild(b);
      }
      answers.hidden = false;
    };

    // bilan : mots revus, mots nouveaux ; puis le commerçant dit au revoir et l'on rentre dans la cour
    const finish = () => {
      this.stallTurn++;
      this.replay = null;
      tag.textContent = '';
      ask.textContent = '';
      board.remove();
      answers.remove();
      prompt.innerHTML = '';
      [...pips.children].forEach((p) => p.classList.remove('on'));
      const words = [...new Map(results.map((x) => [x.word, x])).values()];
      const fresh = words.filter((x) => x.fresh).length;
      const seen = words.length - fresh;
      const sum = div('stall-summary');
      sum.appendChild(Object.assign(document.createElement('p'), { textContent: fmt(ui.stallSummary ?? '', { seen: String(seen), fresh: String(fresh) }) }));
      const list = div('stall-words-done');
      for (const x of words) {
        const cell = div(`stall-done ${results.some((y) => y.word === x.word && y.ok) ? 'ok' : 'ko'}`);
        cell.appendChild(inkWord(c, x.word));
        if (x.fresh) cell.appendChild(Object.assign(document.createElement('small'), { textContent: ui.stallNew ?? '' }));
        list.appendChild(cell);
      }
      sum.appendChild(list);
      prompt.appendChild(sum);
      log({
        scene: this.scene.id,
        step: rounds.length,
        kind: 'stall',
        detail: `summary;rounds=${results.length};ok=${results.filter((x) => x.ok).length};reviewed=${seen};new=${fresh}`,
      });
      if (L.bye) {
        this.stallShow(npc, L.bye, null, 'joy');
        this.stallSpeak(L.bye, null, RATE.NORMAL);
      }
      go(ui.finish, () => this.close(true));
    };

    if (L.open) {
      this.stallShow(npc, L.open, null, 'joy');
      tag.textContent = '';
      this.stallSpeak(L.open, null, RATE.NORMAL, () => setTimeout(round, 250));
      // filet : si la voix ne prévient pas de sa fin, la première manche commence quand même
      const first = this.stallTurn;
      setTimeout(() => {
        if (this.live && k === 0 && this.stallTurn === first) round();
      }, 4500);
    } else round();
  }
}
