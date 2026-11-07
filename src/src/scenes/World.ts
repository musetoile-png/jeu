/**
 * Scène « lieu peint » : plans en parallaxe, bande de marche, joueur, points d'interaction.
 * Chaque lieu (cuisine, boutique, aéroport, bureau, monument…) est un fichier place.json ;
 * passer une porte charge le lieu suivant avec une entrée « découverte » (fondu d'encre, cartouche du nom, recul de la caméra).
 */
import Phaser from 'phaser';

import { KEY } from '../constants';
import { initVoices } from '../engine/audio';
import type { Ambient, Content, Entrance, Hotspot, Place } from '../engine/content';
import { assetUrl, loadContent, t } from '../engine/content';
import { Dialogue } from '../engine/dialogue';
import { keyOutWhite } from '../engine/keyout';
import { ensurePlaceholderPerson, ensurePlaceholderPlane } from '../engine/placeholders';
import { Puppet } from '../engine/puppet';
import * as save from '../engine/save';
import * as ui from '../engine/ui';
import * as notebook from '../engine/notebook';
import { log } from '../engine/log';
import { speak, RATE } from '../engine/audio';
import * as sfx from '../engine/sfx';

const SPEED = 260;
const NEAR = 140;
/** La caméra regarde un peu devant le joueur, du côté où il va (px à l'écran). */
const LOOK_AHEAD = 150;

type Body = Phaser.GameObjects.Sprite | Puppet;

export class World extends Phaser.Scene {
  private content!: Content;
  private place!: Place;
  private player!: Body;
  private shadow!: Phaser.GameObjects.Ellipse;
  private planes: { img: Phaser.GameObjects.Image; parallax: number; offset: number }[] = [];
  private spots: { h: Hotspot; obj: Phaser.GameObjects.Image; prompt: Phaser.GameObjects.Text }[] = [];
  private placeObjects: Phaser.GameObjects.GameObject[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private walkT = 0;
  private frame = 0;
  private busy = false;
  private near: Hotspot | null = null;
  /** Marche automatique d'entrée : distance restante (px, signée). */
  private autoWalk = 0;
  /** Scène à lancer quand la marche d'entrée est finie (onEnter du lieu). */
  private pendingScene: NonNullable<Place['onEnter']>[number] | null = null;
  private night: Phaser.GameObjects.GameObject[] = [];
  /** Mode photo : cadre en coordonnées écran (jeu 1280×720), élément HTML du viseur. */
  private photo: { x: number; y: number; w: number; h: number; el: HTMLElement } | null = null;
  private started = false;
  private plaques: Phaser.GameObjects.Text[] = [];
  /** Une animation de mise en scène est en cours : barres d'interaction masquées. */
  private staging = false;
  /** Passants et animaux en cours, et leurs minuteries (remis à zéro à chaque lieu). */
  private extras: Phaser.GameObjects.GameObject[] = [];
  private extraTimers: Phaser.Time.TimerEvent[] = [];
  /** Le personnage avec qui l'on parle (pour les petites animations de scène). */
  private talkTo: Phaser.GameObjects.Image | undefined;
  /** Sortie au bord du lieu : temps passé à marcher vers le bord (ms) et bannière « Vous sortez vers… ». */
  private exitPush = 0;
  private exitBanner: HTMLElement | null = null;
  private exitBannerFor: string | null = null;
  /** Point d'interaction visé par un clic : on y marche, puis on parle / on entre. */
  private clickTarget: Hotspot | null = null;
  /** Décalage courant de la caméra vers l'avant (px du lieu, signé). */
  private look = 0;

  constructor() {
    super(KEY.SCENE.WORLD);
  }

  preload() {
    this.content = loadContent('shanghai', 'fr');
    // En fichier autonome, on ne charge que les images réellement incorporées (les autres attendent d'être dessinées).
    const inline = (window as unknown as { __inlineAssets?: Record<string, string> }).__inlineAssets;
    for (const [key, path] of Object.entries(this.content.pack.assets.images)) if (!inline || inline[path]) this.load.image(key, assetUrl(path));
    // Une image manquante ne doit jamais bloquer : on laissera la texture de secours.
    this.load.on('loaderror', (f: Phaser.Loader.File) => console.warn('image manquante', f.key));
  }

  create() {
    initVoices(this.content.language.bcp47);
    sfx.initSfx(this.content.pack.assets.sfx);
    document.documentElement.style.setProperty('--zh-font', this.content.language.font);
    // Détourage du blanc sur tout ce qui est livré sur fond blanc (pack.assets.keyWhite)
    for (const key of this.content.pack.assets.keyWhite ?? []) if (this.textures.exists(key)) keyOutWhite(this, key);
    ensurePlaceholderPerson(this, 'player_0', '#58d6a9', false);
    ensurePlaceholderPerson(this, 'player_1', '#58d6a9', true);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,E,P,I,J,O,M,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    document.getElementById('hint')!.textContent = this.content.ui.hintMove;
    // clic / toucher : marcher jusque-là ; sur un personnage ou une porte, y aller puis interagir
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => this.clickTo(ptr.worldX, ptr.worldY));
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      const over = this.started && !this.busy && !this.photo && this.spotAt(ptr.worldX, ptr.worldY);
      this.game.canvas.style.cursor = over ? 'pointer' : '';
    });
    this.cameras.main.setBackgroundColor('#efe9dc');
    this.events.emit('content-ready', this.content);

    // Raccourci de test : ?lieu=cuisine (et éventuellement &scene=cuisine-cran1) saute l'écran titre et l'arrivée.
    const qs = new URLSearchParams(location.search);
    const jump = qs.get('lieu');
    if (jump && this.content.places.has(jump)) {
      if (!save.get().profile) save.newGame(qs.get('corps') === 'f' ? 'f' : 'm', this.content.pack.profile?.startItems ?? []);
      if (qs.get('temps')) save.setFlags({ time: qs.get('temps')! });
      this.started = true;
      document.dispatchEvent(new CustomEvent('game-started'));
      this.enterPlace(jump);
      this.pendingScene = null;
      const sc = qs.get('scene');
      if (sc && this.content.scenes.has(sc)) this.time.delayedCall(900, () => this.playScene(sc));
      return;
    }
    // Écran titre : le monde attend le choix du joueur.
    ui.showTitle(this.content, (c) => {
      if (c.mode === 'new') {
        save.newGame(c.body, this.content.pack.profile?.startItems ?? []);
        log({ scene: 'titre', step: 0, kind: 'choice_set', detail: `body=${c.body}` });
        // l'avion descend sur Shanghai, puis la ruelle
        ui.intro(this.content, () => this.enterPlace(this.content.pack.start.place, this.content.pack.start.entrance));
      } else this.enterPlace(save.get().place ?? this.content.pack.start.place);
      this.started = true;
      document.dispatchEvent(new CustomEvent('game-started'));
    });
  }

  /** Boutons et raccourcis du sac, de la quête, de l'album, de l'appareil photo. */
  openPanel(which: 'bag' | 'quest' | 'album' | 'photo') {
    if (!this.started || this.busy) return;
    if (which === 'bag') ui.showBag(this.content);
    if (which === 'quest') ui.showQuest(this.content);
    if (which === 'album') ui.showAlbum(this.content);
    if (which === 'photo') this.togglePhoto();
  }

  // ---------- Lieux ----------

  private clearPlace() {
    for (const s of this.spots) {
      s.obj.destroy();
      s.prompt.destroy();
    }
    for (const o of this.plaques) o.destroy();
    this.plaques = [];
    for (const o of this.placeObjects) o.destroy();
    this.placeObjects = [];
    for (const t of this.extraTimers) t.remove();
    this.extraTimers = [];
    for (const o of this.extras) o.destroy();
    this.extras = [];
    this.planes = [];
    this.spots = [];
  }

  private buildPlace(place: Place, at: Entrance) {
    this.clearPlace();
    this.place = place;
    const { width: W, height: H } = place.size;
    const zoom = place.zoom ?? 1;

    place.planes.forEach((p, i) => {
      ensurePlaceholderPlane(this, p.image, W, H, i);
      const img = this.add.image(0, p.y, p.image).setOrigin(0, 0);
      img.setDepth(p.depth === 'above' ? 2000 : i);
      // Un plan qui ne bouge pas à la vitesse de la caméra doit être un peu plus large que le lieu,
      // sinon un bord de papier apparaît quand on arrive au bout.
      const slack = Math.abs(1 - p.parallax) * Math.max(0, W - 1280 / zoom);
      img.setScale(1 + slack / W);
      this.planes.push({ img, parallax: p.parallax, offset: p.parallax < 1 ? -slack : 0 });
      this.placeObjects.push(img);
    });

    for (const pr of place.props ?? []) {
      if (!save.matches(pr.when) || !this.textures.exists(pr.image)) continue;
      const img = this.add
        .image(pr.x, pr.y, pr.image)
        .setOrigin(0.5, 1)
        .setScale(pr.scale ?? 1)
        .setDepth(pr.depth ?? pr.y);
      this.placeObjects.push(img);
    }

    this.buildSpots(place);

    for (const sign of place.signs ?? []) {
      const txt = this.add
        .text(sign.x, sign.y, sign.text[this.content.language.code] ?? '', {
          fontFamily: `'Ma Shan Zheng', ${this.content.language.font}`,
          fontSize: `${sign.size ?? 48}px`,
          color: sign.color ?? '#2b2b33',
        })
        .setOrigin(0.5)
        .setDepth(1.5)
        .setAlpha(0.88);
      this.placeObjects.push(txt);
    }

    this.makePlayer(at);
    this.startAmbient(place);
    sfx.ambience(place.ambience);
    this.look = 0;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.startFollow(this.player, true, 0.1, 0.1);
    cam.setZoom(zoom);
  }

  /** Points d'interaction visibles selon les drapeaux de l'histoire ; reconstruits quand ils changent. */
  private buildSpots(place: Place) {
    for (const o of this.plaques) o.destroy();
    this.plaques = [];
    for (const s of this.spots) {
      s.obj.destroy();
      s.prompt.destroy();
    }
    this.spots = [];
    for (const h of place.hotspots) {
      if (!save.matches(h.when)) continue;
      if (h.kind === 'subject') {
        // sujets photo : invisibles hors du viseur
        const obj = this.add.image(h.x, h.y, '__WHITE').setAlpha(0);
        const prompt = this.add.text(0, 0, '').setVisible(false);
        this.spots.push({ h, obj, prompt });
        continue;
      }
      const closed = h.kind === 'exit' && !(h.to && this.content.places.has(h.to));
      const key = h.sprite ?? `spot_${h.kind}`;
      if (!this.textures.exists(key)) ensurePlaceholderPerson(this, key, h.kind === 'npc' ? '#3b5bd6' : '#d6322a');
      const obj = this.add
        .image(h.x, h.y, key)
        .setOrigin(0.5, 1)
        .setDepth(h.behind ? 0.5 : h.y)
        .setScale(h.scale ?? 1);
      if (h.kind === 'exit') obj.setAlpha(0.001);
      // un personnage n'est jamais figé : il respire (étirement très léger depuis les pieds)
      if (h.kind === 'npc') this.tweens.add({ targets: obj, scaleY: obj.scaleY * 1.012, duration: Phaser.Math.Between(1700, 2400), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      // une porte fermée affiche une pancarte en chinois : le verrou est une phrase à lire
      const signLine = this.content.pack.closedSign;
      const signText = closed && signLine ? save.resolveLine(this.content, signLine).map((tk) => (tk[0] === 'w' ? (this.content.lexicon.get(tk[1])?.target ?? '') : tk[0] === 'v' ? '' : tk[1])).join('') : '';
      const verb = closed ? `${this.content.ui.closed ?? '✕'} ${signText}` : h.kind === 'exit' ? (this.content.ui.enter ?? '↑') : this.content.ui.talk;
      const prompt = this.add
        .text(h.x, Math.max(h.y - (h.kind === 'exit' ? this.exitPromptHeight(place) : obj.displayHeight) - 16, 48), ` ${verb} · ${t(this.content, h.prompt)} `, {
          fontFamily: `'Nunito Sans', ${this.content.language.font}`,
          fontSize: '20px',
          color: closed ? '#efe9dc' : '#1b1b2a',
          backgroundColor: closed ? '#5a5a66' : '#ffa23f',
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5)
        .setDepth(3000)
        .setVisible(false)
        .setData('y0', Math.max(h.y - (h.kind === 'exit' ? this.exitPromptHeight(place) : obj.displayHeight) - 16, 48));
      if (closed && signText) {
        const plaque = this.add
          .text(h.x, h.y - this.exitPromptHeight(place) * 1.15, signText, {
            fontFamily: `'Ma Shan Zheng', ${this.content.language.font}`,
            fontSize: '30px',
            color: '#2b2b33',
            backgroundColor: '#e3dbc9',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(h.y + 1);
        this.plaques.push(plaque);
      }
      this.spots.push({ h, obj, prompt });
    }
  }

  /** Variante de nuit : voile bleu-encre et halos chauds autour des lanternes. */
  private applyNight(place: Place) {
    for (const o of this.night) o.destroy();
    this.night = [];
    if (save.flag('time') !== 'nuit' || !place.night) return;
    const n = place.night;
    const veil = this.add
      .rectangle(0, 0, place.size.width, place.size.height, Phaser.Display.Color.HexStringToColor(n.tint).color, n.alpha)
      .setOrigin(0, 0)
      .setDepth(1900)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.night.push(veil);
    for (const l of n.lights ?? []) {
      const c = Phaser.Display.Color.HexStringToColor(l.color).color;
      for (let k = 0; k < 4; k++) this.night.push(this.add.circle(l.x, l.y, l.r * (1 - k * 0.22), c, 0.07).setDepth(1901).setBlendMode(Phaser.BlendModes.ADD));
    }
  }

  private makePlayer(at: Entrance) {
    this.player?.destroy();
    this.shadow?.destroy();
    const body = save.get().profile.body;
    const art = body === 'f' ? (this.content.pack.assets.playerF ?? undefined) : this.content.pack.assets.player;
    const rigged = art?.rig && this.textures.exists(art.side) && art.rig.legs.every((l) => this.textures.exists(l.key));
    if (art?.rig && rigged) {
      this.player = new Puppet(this, at.x, at.y, { ...art, rig: art.rig, height: (art.height ?? 600) * (this.place.playerScale ?? 1) });
      this.player.setFacing(at.facing === 'left');
    } else {
      this.player = this.add.sprite(at.x, at.y, 'player_0').setOrigin(0.5, 1).setFlipX(at.facing === 'left');
      this.player.setData('base', this.place.playerScale ?? 1);
    }
    this.player.setDepth(at.y);
    // ombre au sol, lavis d'encre : ancre le personnage dans le décor
    const ps = this.place.playerScale ?? 1;
    this.shadow = this.add.ellipse(at.x, at.y - 2, 150 * ps, 26 * ps, 0x2b2b33, 0.2).setDepth(at.y - 1);
    this.autoWalk = at.walkIn ?? 0;
  }

  /** Une porte n'a pas de sprite : on place son étiquette au-dessus de la tête du joueur. */
  private exitPromptHeight(place: Place) {
    return (this.content.pack.assets.player?.height ?? 300) * (place.playerScale ?? 1) + 40;
  }

  /** Entrée dans un lieu : fondu d'encre, cartouche du nom, recul de caméra, quelques pas automatiques. */
  private enterPlace(placeId: string, entranceId?: string) {
    const place = this.content.places.get(placeId);
    if (!place) return;
    this.stage(true);
    const at = (entranceId && place.entrances?.[entranceId]) || place.spawn;
    this.buildPlace(place, at);
    this.applyNight(place);
    save.setPlace(placeId);
    // scène d'arrivée (prologue…) : lancée quand le joueur a fini d'entrer
    this.pendingScene = place.onEnter?.find((e) => save.matches(e.when)) ?? null;

    const cam = this.cameras.main;
    const zoom = place.zoom ?? 1;
    cam.setZoom(zoom * 1.35);
    cam.fadeIn(700, 0xef, 0xe9, 0xdc);
    cam.zoomTo(zoom, 1800, 'Sine.easeInOut');
    this.titleCard(place);
  }

  /** Sortie posée au bord du lieu (porte de cuisine, sortie de la cour…) : -1 gauche, 1 droite, 0 sinon. */
  private edgeDir(h: Hotspot) {
    if (h.kind !== 'exit' || !h.to || !this.content.places.has(h.to)) return 0;
    const w = this.place.walk;
    if (h.x - w.xMin < 260) return -1;
    if (w.xMax - h.x < 260) return 1;
    return 0;
  }

  /** Bannière « ← Vous sortez vers : 弄堂 la ruelle », avec une jauge qui se remplit tant qu'on avance. */
  private showExitBanner(h: Hotspot | null, dir: number, progress: number) {
    if (!h) {
      if (this.exitBanner) {
        this.exitBanner.classList.remove('on');
        this.exitBannerFor = null;
      }
      return;
    }
    const stage = document.getElementById('stage');
    if (!stage) return;
    if (!this.exitBanner || !this.exitBanner.isConnected) {
      this.exitBanner = document.createElement('div');
      this.exitBanner.className = 'exitbanner';
      stage.appendChild(this.exitBanner);
    }
    const el = this.exitBanner;
    if (this.exitBannerFor !== h.id) {
      const to = this.content.places.get(h.to!)!;
      const code = this.content.language.code;
      const arrow = dir < 0 ? '←' : '→';
      el.innerHTML = '';
      el.classList.toggle('right', dir > 0);
      const a = document.createElement('span');
      a.className = 'arrow';
      a.textContent = arrow;
      const txt = document.createElement('span');
      txt.className = 'txt';
      const small = document.createElement('small');
      small.textContent = this.content.ui.exitTo ?? 'Vous sortez vers';
      const b = document.createElement('b');
      b.textContent = to.name[code] ?? '';
      const i = document.createElement('i');
      i.textContent = to.name.fr ?? '';
      txt.append(small, b, i);
      const g = document.createElement('span');
      g.className = 'gauge';
      g.appendChild(document.createElement('span'));
      dir < 0 ? el.append(a, txt) : el.append(txt, a);
      el.appendChild(g);
      this.exitBannerFor = h.id;
    }
    el.classList.add('on');
    (el.querySelector('.gauge span') as HTMLElement).style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
  }

  /** Point d'interaction sous le pointeur (coordonnées du monde). */
  private spotAt(wx: number, wy: number): Hotspot | null {
    if (!this.place) return null;
    let best: Hotspot | null = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      const h = s.h;
      if (h.kind === 'subject' || h.kind === 'object') continue;
      const dir = this.edgeDir(h);
      let hit: boolean;
      if (dir < 0) hit = wx < h.x + 90;
      else if (dir > 0) hit = wx > h.x - 90;
      else if (h.kind === 'exit') hit = Math.abs(wx - h.x) < 110 && wy > h.y - this.exitPromptHeight(this.place) && wy < h.y + 60;
      else hit = Math.abs(wx - h.x) < Math.max(70, s.obj.displayWidth * 0.4) && wy > h.y - s.obj.displayHeight - 20 && wy < h.y + 60;
      const d = Math.abs(wx - h.x);
      if (hit && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  /** Clic ou toucher dans le décor : on marche jusque-là ; sur un personnage ou une porte, on y va puis on interagit. */
  private clickTo(wx: number, wy: number) {
    const p = this.player;
    if (!this.started || this.busy || this.photo || ui.panelOpen() || !p || this.pendingScene) return;
    const w = this.place.walk;
    const h = this.spotAt(wx, wy);
    this.clickTarget = null;
    if (!h) {
      const tx = Phaser.Math.Clamp(wx, w.xMin, w.xMax);
      this.autoWalk = tx - p.x;
      this.ripple(tx, p.y);
      return;
    }
    const dir = this.edgeDir(h);
    if (dir) {
      // vers le bord : on marche, la bannière apparaît et l'on sort en continuant
      this.autoWalk = dir < 0 ? w.xMin - p.x - 600 : w.xMax - p.x + 600;
      return;
    }
    if (Phaser.Math.Distance.Between(p.x, p.y, h.x, h.y) < NEAR) {
      this.activate(h);
      return;
    }
    const side = Math.sign(p.x - h.x) || -1;
    this.autoWalk = Phaser.Math.Clamp(h.x + side * 90, w.xMin, w.xMax) - p.x;
    this.clickTarget = h;
  }

  /** Rond d'encre au sol là où l'on a cliqué : le jeu a compris où aller. */
  private ripple(x: number, y: number) {
    const ps = this.place.playerScale ?? 1;
    const ring = this.add.ellipse(x, y - 2, 30 * ps, 8 * ps).setStrokeStyle(3, 0x2b2b33, 0.45).setDepth(y - 1);
    this.tweens.add({ targets: ring, scaleX: 3.2, scaleY: 3.2, alpha: 0, duration: 650, ease: 'Sine.easeOut', onComplete: () => ring.destroy() });
  }

  /** Étiquette d'un point d'interaction : elle monte en fondu quand on approche, redescend quand on s'éloigne. */
  private promptOn(prompt: Phaser.GameObjects.Text, on: boolean) {
    if (prompt.getData('on') === on) return;
    prompt.setData('on', on);
    const y0 = (prompt.getData('y0') as number | undefined) ?? prompt.y;
    this.tweens.killTweensOf(prompt);
    if (on) {
      prompt.setVisible(true).setAlpha(0).setY(y0 + 10).setScale(0.92);
      this.tweens.add({ targets: prompt, alpha: 1, y: y0, scale: 1, duration: 220, ease: 'Back.easeOut' });
    } else {
      this.tweens.add({ targets: prompt, alpha: 0, y: y0 + 6, duration: 160, ease: 'Sine.easeIn', onComplete: () => prompt.setVisible(false) });
    }
  }

  private activate(h: Hotspot) {
    this.clickTarget = null;
    this.showExitBanner(null, 0, 0);
    if (h.kind === 'npc') this.openScene(h);
    if (h.kind === 'exit') this.leaveTo(h);
  }

  private leaveTo(h: Hotspot) {
    if (!h.to || !this.content.places.has(h.to)) return;
    this.exitPush = 0;
    this.showExitBanner(null, 0, 0);
    this.busy = true;
    this.stage(true);
    sfx.play('door');
    const cam = this.cameras.main;
    cam.zoomTo((this.place.zoom ?? 1) * 1.25, 600, 'Sine.easeIn');
    cam.fadeOut(600, 0xef, 0xe9, 0xdc);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.enterPlace(h.to!, h.toEntrance);
      this.busy = false;
    });
  }

  /** Mise en scène : pendant l'animation, ni barre de jeu, ni aide, ni dialogue à l'écran. */
  private stage(on: boolean) {
    if (this.staging === on) return;
    this.staging = on;
    ui.setAnim('world', on);
  }

  /** Nom du lieu en calligraphie, sous-titré, qui s'efface comme de l'encre qui sèche (HTML, net à toute taille). */
  private titleCard(place: Place) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    stage.querySelector('.placecard')?.remove();
    const card = document.createElement('div');
    card.className = 'placecard';
    const big = document.createElement('b');
    big.textContent = place.name[this.content.language.code] ?? '';
    const small = document.createElement('i');
    small.textContent = t(this.content, place.name);
    card.append(big, small);
    stage.appendChild(card);
    setTimeout(() => card.remove(), 4000);
  }

  // ---------- Dialogues ----------

  private openScene(h: Hotspot) {
    const sc = this.content.scenes.get(h.scene ?? '');
    if (!sc) return;
    this.busy = true;
    // Le joueur se met de côté pour ne pas masquer son interlocuteur, puis se tourne vers nous.
    const p = this.player;
    const auto = h.id.startsWith('auto:');
    const side = p.x <= h.x ? -1 : 1;
    const x = auto ? p.x : Phaser.Math.Clamp(h.x + side * 300, this.place.walk.xMin, this.place.walk.xMax);
    // gros plan : la caméra cadre les deux personnages d'un côté, le panneau d'action se pose de l'autre
    const panelSide = this.frameDialogue(auto ? [x] : [x, h.x], Math.max(p.y, h.y));
    const npcSpot = auto ? undefined : this.spots.find((s) => s.h.id === h.id);
    this.talkTo = npcSpot?.obj;
    if (p instanceof Puppet) p.setFacing(side > 0);
    this.tweens.add({
      targets: p,
      x,
      duration: Math.min(700, Math.abs(p.x - x) * 2.5),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.shadow.x = p.x;
        if (p instanceof Puppet) p.step(16, true);
      },
      onComplete: () => {
        if (p instanceof Puppet) p.setTalking(true);
      },
    });
    const dlg = new Dialogue(this.content, sc, {
      imageUrl: (key) =>
        this.textures.exists(key) && !key.startsWith('spot_') && this.content.pack.assets.images[key]
          ? assetUrl(this.content.pack.assets.images[key])
          : undefined,
      onEffect: (fx) => this.effect(fx),
      side: panelSide,
      onSpeak: (actor) => this.speakBob(actor === 'player' ? undefined : actor === sc.npc ? npcSpot?.obj : this.spots.find((s) => s.h.sprite?.startsWith(actor))?.obj),
      anchor: (actor) => this.headOf(actor === 'player' ? this.player : actor === sc.npc ? npcSpot?.obj : this.spots.find((s) => s.h.sprite?.startsWith(actor))?.obj),
      onClose: (success) => {
        this.busy = false;
        this.unframeDialogue();
        if (this.player instanceof Puppet) this.player.setTalking(false);
        if (success) this.sceneEnd(sc.id);
      },
    });
    dlg.open();
  }

  /**
   * Cadrage de dialogue : léger zoom, les personnages calés au tiers gauche (ou droit) de l'image,
   * pieds en bas ; l'autre côté reste libre pour le panneau d'action. Renvoie le côté du panneau.
   */
  private frameDialogue(xs: number[], feetY: number): 'left' | 'right' {
    const cam = this.cameras.main;
    const z = (this.place.zoom ?? 1) * 1.12;
    const { width: WW, height: WH } = this.place.size;
    const vw = 1280 / z;
    const vh = 720 / z;
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const clampX = (cx: number) => (WW <= vw ? WW / 2 : Phaser.Math.Clamp(cx, vw / 2, WW - vw / 2));
    const best = (['right', 'left'] as const)
      .map((side) => {
        const want = side === 'right' ? 0.36 : 0.64;
        const cx = clampX(mid + (0.5 - want) * vw);
        return { side, cx, err: Math.abs((mid - (cx - vw / 2)) / vw - want) };
      })
      .sort((a, b) => a.err - b.err)[0];
    const cy = WH <= vh ? WH / 2 : Phaser.Math.Clamp(feetY + 0.06 * vh - vh / 2, vh / 2, WH - vh / 2);
    cam.stopFollow();
    cam.pan(best.cx, cy, 900, 'Sine.easeInOut');
    cam.zoomTo(z, 900, 'Sine.easeInOut');
    return best.side;
  }

  private unframeDialogue() {
    const cam = this.cameras.main;
    cam.zoomTo(this.place.zoom ?? 1, 800, 'Sine.easeInOut');
    cam.startFollow(this.player, true, 0.08, 0.08);
  }

  /** Haut de la tête d'un personnage, en fraction de l'image affichée. */
  private headOf(obj: Phaser.GameObjects.Image | Body | undefined) {
    if (!obj?.active) return null;
    const cam = this.cameras.main;
    const v = cam.worldView;
    const b = obj.getBounds();
    const x = (b.centerX - v.x) / v.width;
    const y = (b.top + b.height * 0.04 - v.y) / v.height;
    return x < -0.05 || x > 1.05 ? null : { x, y };
  }

  /** Petit sursaut de celui qui parle (marionnette de papier qu'on agite). */
  private speakBob(obj: Phaser.GameObjects.Image | undefined) {
    if (!obj?.active) return;
    const y = obj.y;
    this.tweens.add({ targets: obj, y: y - 6, duration: 110, yoyo: true, repeat: 1, ease: 'Sine.easeOut', onComplete: () => obj.setY(y) });
  }

  // ---------- Vie du lieu : passants, chats, moineaux ----------

  private startAmbient(place: Place) {
    for (const a of place.ambient ?? []) {
      if (!this.textures.exists(a.image)) continue; // pas encore dessiné : personne
      const [lo, hi] = a.every ?? [10, 25];
      const plan = (first: boolean) => {
        const wait = (first ? Phaser.Math.FloatBetween(0.5, lo) : Phaser.Math.FloatBetween(lo, hi)) * 1000;
        this.extraTimers.push(
          this.time.delayedCall(wait, () => {
            if (save.matches(a.when) && this.place === place) this.spawnExtra(a);
            plan(false);
          }),
        );
      };
      plan(true);
    }
  }

  private spawnExtra(a: Ambient) {
    const W = this.place.size.width;
    const y = Array.isArray(a.y) ? Phaser.Math.Between(a.y[0], a.y[1]) : a.y;
    const src = this.textures.get(a.image).getSourceImage() as HTMLImageElement;
    const scale = a.height / src.height;
    const right = Math.random() < 0.5;
    const flip = (a.facing ?? 'right') === 'right' ? !right : right;
    const startX = right ? -160 : W + 160;
    const img = this.add.image(startX, y, a.image).setOrigin(0.5, 1).setScale(scale).setFlipX(flip).setDepth(y);
    const shadow = this.add.ellipse(startX, y - 2, a.height * 0.45, a.height * 0.07, 0x2b2b33, 0.16).setDepth(y - 1);
    this.extras.push(img, shadow);
    const speed = a.speed ?? 70;
    const done = () => {
      img.destroy();
      shadow.destroy();
      this.extras = this.extras.filter((o) => o !== img && o !== shadow);
    };
    const follow = () => shadow.setX(img.x);

    if (a.kind === 'hop') {
      // des moineaux se posent, picorent par petits bonds, puis s'envolent
      const x0 = Phaser.Math.Between(200, W - 200);
      img.setPosition(x0, y - 220).setAlpha(0);
      shadow.setPosition(x0, y - 2).setAlpha(0);
      this.tweens.add({ targets: img, y, alpha: 1, duration: 700, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: shadow, alpha: 0.16, duration: 700 });
      this.tweens.chain({
        targets: img,
        delay: 700,
        tweens: [
          ...Array.from({ length: Phaser.Math.Between(4, 8) }, () => ({ x: `+=${Phaser.Math.Between(-24, 24)}`, y: y - 10, duration: 140, yoyo: true, hold: Phaser.Math.Between(300, 900), onUpdate: follow })),
          { y: y - 400, x: `+=${right ? 300 : -300}`, alpha: 0, duration: 900, ease: 'Sine.easeIn' },
        ],
        onComplete: done,
      });
      return;
    }

    // marche de marionnette : petits sauts réguliers et léger balancement
    const bob = this.tweens.add({ targets: img, y: y - Math.max(3, a.height * 0.018), duration: 210, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const sway = this.tweens.add({ targets: img, angle: { from: -1.2, to: 1.2 }, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const walk = (toX: number, then: () => void) =>
      this.tweens.add({ targets: img, x: toX, duration: (Math.abs(toX - img.x) / speed) * 1000, onUpdate: follow, onComplete: then });

    if (a.kind === 'rest') {
      // le chat traverse à moitié, s'assoit un moment, puis repart
      const stopX = Phaser.Math.Between(Math.round(W * 0.2), Math.round(W * 0.8));
      walk(stopX, () => {
        bob.pause();
        sway.pause();
        img.setAngle(0).setY(y);
        if (a.restImage && this.textures.exists(a.restImage)) img.setTexture(a.restImage);
        const breathe = this.tweens.add({ targets: img, scaleY: scale * 1.02, duration: 1300, yoyo: true, repeat: -1 });
        this.time.delayedCall(Phaser.Math.Between(6000, 14000), () => {
          if (!img.active) return;
          breathe.remove();
          img.setTexture(a.image).setScale(scale);
          bob.resume();
          sway.resume();
          walk(right ? W + 160 : -160, done);
        });
      });
      return;
    }
    walk(right ? W + 160 : -160, done);
  }

  /** Lance une scène sans point d'interaction (scène d'arrivée, prologue). */
  private playScene(id: string) {
    this.openScene({ id: `auto:${id}`, kind: 'npc', x: this.player.x + 320, y: this.player.y, scene: id, prompt: {} });
  }

  /** Conséquences d'une scène réussie : drapeaux, objets, nouveau lieu, cartouche. */
  private sceneEnd(id: string) {
    const end = this.content.scenes.get(id)?.onEnd;
    if (!end) return;
    if (end.flags) save.setFlags(end.flags);
    for (const it of end.give ?? []) {
      if (save.hasItem(it)) continue;
      save.addItem(it);
      ui.flyToBag(this.content, it);
      const item = this.content.items.get(it);
      if (item) ui.toast(this.content, item.word, `${this.content.ui.received ?? '+'} ${t(this.content, this.content.lexicon.get(item.word)?.gloss)}`);
      log({ scene: id, step: -1, kind: 'item_get', detail: it, word: item?.word });
    }
    // liste de courses complète : on peut rapporter les achats
    if (ui.checkErrands(this.content)) log({ scene: id, step: -1, kind: 'errand_ready' });
    if (save.get().quest && end.flags?.prologue) log({ scene: id, step: -1, kind: 'quest_choice', detail: save.get().quest });
    if (end.goto) {
      const go = end.goto;
      this.busy = true;
      this.stage(true);
      sfx.play('door');
      this.cameras.main.fadeOut(900, 0x1d, 0x24, 0x40);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.enterPlace(go.place, go.entrance);
        if (end.card) setTimeout(() => ui.card(this.content, end.card?.[this.content.language.code] ?? '', t(this.content, end.card)), 300);
        this.busy = false;
      });
    } else {
      this.buildSpots(this.place);
      this.applyNight(this.place);
    }
  }

  private effect(fx: string) {
    if (fx.startsWith('pick:')) this.cameras.main.flash(180, 255, 200, 120);
    if (fx === 'chao') this.cameras.main.shake(300, 0.004);
    if (fx === 'bowl') this.cameras.main.flash(260, 255, 220, 160);
    if (fx === 'dog') this.dogRuns();
    if (fx === 'pay') this.payAnim();
    if (fx === 'tea') this.steam();
  }

  /** On paie : un billet passe de la main du joueur à celle du marchand. */
  private payAnim() {
    const to = this.talkTo;
    if (!to?.active) return;
    const key = this.textures.exists('item_qian') ? 'item_qian' : undefined;
    const from = this.player.getBounds();
    const note = key
      ? this.add.image(from.centerX, from.centerY, key).setDisplaySize(70, 70 * (this.textures.get(key).getSourceImage().height / this.textures.get(key).getSourceImage().width))
      : this.add.rectangle(from.centerX, from.centerY, 60, 30, 0xd6322a, 0.85);
    note.setDepth(3000);
    const tb = to.getBounds();
    this.tweens.add({
      targets: note,
      x: tb.centerX,
      y: tb.centerY,
      angle: 200,
      duration: 900,
      ease: 'Sine.easeInOut',
      onComplete: () => this.tweens.add({ targets: note, alpha: 0, scale: 0.2, duration: 250, onComplete: () => note.destroy() }),
    });
  }

  /** Le thé est servi : un peu de vapeur monte. */
  private steam() {
    const to = this.talkTo;
    const b = to?.active ? to.getBounds() : this.player.getBounds();
    for (let k = 0; k < 7; k++) {
      const puff = this.add.circle(b.centerX + Phaser.Math.Between(-18, 18), b.centerY, Phaser.Math.Between(6, 11), 0xffffff, 0.5).setDepth(3000);
      this.tweens.add({ targets: puff, y: b.centerY - Phaser.Math.Between(90, 150), x: `+=${Phaser.Math.Between(-20, 20)}`, scale: 2.2, alpha: 0, delay: k * 220, duration: 1600, ease: 'Sine.easeOut', onComplete: () => puff.destroy() });
    }
  }

  /** Le chien surgit, attrape le portefeuille et file au bout de la ruelle. */
  private dogRuns() {
    const p = this.player;
    const key = this.textures.exists('dog') ? 'dog' : 'dog_ph';
    if (key === 'dog_ph' && !this.textures.exists('dog_ph')) {
      // silhouette d'encre en attendant l'illustration du chien
      const tex = this.textures.createCanvas('dog_ph', 170, 110)!;
      const c = tex.getContext();
      c.fillStyle = '#7a5a3c';
      c.beginPath();
      c.ellipse(72, 56, 60, 22, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(132, 38, 20, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(130, 22);
      c.lineTo(142, 4);
      c.lineTo(148, 26);
      c.fill();
      c.fillRect(30, 70, 10, 36);
      c.fillRect(98, 70, 10, 36);
      c.fillRect(8, 40, 22, 6);
      c.fillStyle = '#d6322a';
      c.fillRect(146, 46, 20, 13);
      tex.refresh();
    }
    // l'illustration court déjà vers la gauche ; la silhouette de secours est dessinée vers la droite
    const real = key === 'dog';
    const scale = (this.place.playerScale ?? 1) * (real ? 0.85 : 1.4);
    const dog = this.add.image(this.place.size.width + 120, p.y + 4, key).setOrigin(0.5, 1).setScale(scale).setDepth(1950).setFlipX(!real);
    // assez lent pour qu'on le voie : il arrive en trottant, s'arrête net au portefeuille, repart en courant
    const IN = 2200;
    const PAUSE = 450;
    const OUT = 2600;
    this.tweens.chain({
      targets: dog,
      tweens: [
        { x: p.x + 60, duration: IN, ease: 'Sine.easeOut' },
        { x: p.x + 40, duration: PAUSE, ease: 'Sine.easeInOut', onStart: () => this.cameras.main.shake(180, 0.002) },
        { x: -220, duration: OUT, ease: 'Sine.easeIn' },
      ],
      onComplete: () => dog.destroy(),
    });
    // petits bonds de course
    this.tweens.add({ targets: dog, y: dog.y - 9, duration: 170, yoyo: true, repeat: Math.round((IN + PAUSE + OUT) / 340) });
  }

  // ---------- Appareil photo ----------

  private togglePhoto() {
    if (this.photo) {
      this.photo.el.remove();
      this.photo = null;
      return;
    }
    const need = this.content.pack.photo?.item;
    if (need && !save.hasItem(need)) {
      const it = this.content.items.get(need);
      if (it) ui.toast(this.content, it.word, this.content.ui.needCamera ?? '');
      return;
    }
    const el = document.createElement('div');
    el.className = 'viewfinder';
    el.innerHTML = `<div class="frame"></div><p>${this.content.ui.photoHelp ?? ''}</p>`;
    document.getElementById('stage')!.appendChild(el);
    this.photo = { x: 640, y: 330, w: 420, h: 300, el };
    this.placeFrame();
  }

  private placeFrame() {
    if (!this.photo) return;
    const f = this.photo.el.querySelector<HTMLElement>('.frame')!;
    const { x, y, w, h } = this.photo;
    Object.assign(f.style, { left: `${((x - w / 2) / 1280) * 100}%`, top: `${((y - h / 2) / 720) * 100}%`, width: `${(w / 1280) * 100}%`, height: `${(h / 720) * 100}%` });
    f.classList.toggle('hit', !!this.subjectInFrame());
  }

  /** Rectangle du viseur en coordonnées du lieu. */
  private frameRect() {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const { x, y, w, h } = this.photo!;
    const sx = v.width / 1280;
    const sy = v.height / 720;
    return { x: v.x + (x - w / 2) * sx, y: v.y + (y - h / 2) * sy, w: w * sx, h: h * sy };
  }

  private subjectInFrame() {
    const r = this.frameRect();
    return this.spots.find((s) => s.h.kind === 'subject' && s.h.x > r.x && s.h.x < r.x + r.w && s.h.y > r.y && s.h.y < r.y + r.h)?.h;
  }

  private shoot() {
    if (!this.photo) return;
    this.cameras.main.flash(160, 255, 255, 255);
    const subj = this.subjectInFrame();
    const rect = this.frameRect();
    if (!subj?.word) {
      ui.toast(this.content, 'xiangji', this.content.ui.photoMiss ?? '');
      return;
    }
    // nommer la photo : le mot parmi trois, avec des distracteurs pris dans les mots déjà rencontrés
    const word = subj.word;
    const known = notebook.all().filter((w) => w !== word && this.content.lexicon.has(w) && this.content.lexicon.get(w)?.pos === 'n');
    const pool = known.length >= 2 ? known : [...this.content.lexicon.keys()].filter((w) => w !== word);
    const opts = [word, ...pool.sort(() => Math.random() - 0.5).slice(0, 2)].sort(() => Math.random() - 0.5);
    const q = document.createElement('div');
    q.className = 'photo-quiz';
    q.innerHTML = `<p>${this.content.ui.photoName ?? ''}</p>`;
    const row = document.createElement('div');
    row.className = 'picks';
    for (const w of opts) {
      const b = document.createElement('button');
      b.className = 'pick hanzi';
      b.innerHTML = `<span class="ph"></span>`;
      b.querySelector('.ph')!.textContent = this.content.lexicon.get(w)?.target ?? w;
      b.onclick = () => {
        const ok = w === word;
        log({ scene: `photo:${this.place.id}`, step: 0, kind: 'answer', ok, word, detail: `photo=${subj.id};pick=${w}` });
        if (!ok) {
          b.classList.add('nope');
          return;
        }
        const e = this.content.lexicon.get(word);
        if (e) speak(this.content, e.target, `w_${word}`, RATE.WORD);
        notebook.meet(word, `photo:${this.place.id}:${subj.id}`);
        save.addPhoto({ subject: subj.id, place: this.place.id, word, rect, t: Date.now() });
        log({ scene: `photo:${this.place.id}`, step: 0, kind: 'photo_taken', word, detail: subj.id });
        document.dispatchEvent(new CustomEvent('notebook-changed'));
        ui.toast(this.content, word, this.content.ui.photoSaved ?? '');
        q.remove();
      };
      row.append(b);
    }
    q.append(row);
    this.photo.el.appendChild(q);
  }

  // ---------- Boucle ----------

  update() {
    const dt = Math.min(this.game.loop.rawDelta, 100); // temps réel, borné : même vitesse à 30 ou 60 fps
    const p = this.player;
    if (!this.started || !p) return;
    // parallaxe : aussi pendant les dialogues (la caméra recadre)
    const cam0 = this.cameras.main;
    for (const pl of this.planes) pl.img.x = pl.offset - cam0.scrollX * (pl.parallax - 1);
    const JD = Phaser.Input.Keyboard.JustDown;
    if (!this.busy) {
      if (JD(this.keys.I)) ui.panelOpen() ? ui.closePanel() : this.openPanel('bag');
      if (JD(this.keys.J)) ui.panelOpen() ? ui.closePanel() : this.openPanel('quest');
      if (JD(this.keys.O)) ui.panelOpen() ? ui.closePanel() : this.openPanel('album');
      if (JD(this.keys.P)) this.togglePhoto();
      if (JD(this.keys.M)) document.dispatchEvent(new CustomEvent('toggle-sound'));
      if (JD(this.keys.ESC)) {
        ui.closePanel();
        if (this.photo) this.togglePhoto();
      }
    }
    if (this.photo) {
      // viseur : les flèches déplacent le cadre, Espace déclenche
      const f = this.photo;
      const sp = 0.5 * dt;
      if (this.cursors.left.isDown || this.keys.A.isDown) f.x = Math.max(f.w / 2, f.x - sp);
      if (this.cursors.right.isDown || this.keys.D.isDown) f.x = Math.min(1280 - f.w / 2, f.x + sp);
      if (this.cursors.up.isDown || this.keys.W.isDown) f.y = Math.max(f.h / 2, f.y - sp);
      if (this.cursors.down.isDown || this.keys.S.isDown) f.y = Math.min(720 - f.h / 2, f.y + sp);
      this.placeFrame();
      if (JD(this.keys.SPACE) && !f.el.querySelector('.photo-quiz')) this.shoot();
      if (p instanceof Puppet) p.step(dt, false);
      return;
    }
    if (ui.panelOpen()) {
      if (p instanceof Puppet) p.step(dt, false);
      return;
    }
    if (this.busy) {
      for (const s of this.spots) this.promptOn(s.prompt, false);
      this.showExitBanner(null, 0, 0);
      if (p instanceof Puppet && !this.tweens.isTweening(p)) p.step(dt, false);
      return;
    }
    let L = this.cursors.left.isDown || this.keys.A.isDown;
    let R = this.cursors.right.isDown || this.keys.D.isDown;
    const U = this.cursors.up.isDown || this.keys.W.isDown;
    const D = this.cursors.down.isDown || this.keys.S.isDown;
    // marche d'entrée : quelques pas tout seul, interrompue dès que le joueur prend la main
    if (this.autoWalk !== 0) {
      if (L || R || U || D) {
        this.autoWalk = 0;
        this.clickTarget = null;
      } else {
        R = this.autoWalk > 0;
        L = this.autoWalk < 0;
        const stepPx = SPEED * 0.8 * (dt / 1000);
        this.autoWalk = Math.abs(this.autoWalk) <= stepPx ? 0 : this.autoWalk - Math.sign(this.autoWalk) * stepPx;
      }
    }
    if (this.autoWalk === 0 && this.pendingScene) {
      // petite mise en scène d'abord (le chien…), puis le dialogue
      const e = this.pendingScene;
      this.pendingScene = null;
      this.busy = true;
      if (e.effect) this.effect(e.effect);
      this.time.delayedCall(e.delay ?? 0, () => {
        this.busy = false;
        this.stage(false);
        this.playScene(e.scene);
      });
      return;
    }
    // arrivée terminée (ou le joueur a pris la main) : l'interface revient
    if (this.staging && this.autoWalk === 0) this.stage(false);
    const vx = ((R ? 1 : 0) - (L ? 1 : 0)) * SPEED * (dt / 1000);
    const vy = ((D ? 1 : 0) - (U ? 1 : 0)) * SPEED * 0.6 * (dt / 1000);
    const w = this.place.walk;
    p.x = Phaser.Math.Clamp(p.x + vx, w.xMin, w.xMax);
    p.y = Phaser.Math.Clamp(p.y + vy, w.yMin, w.yMax);
    p.setDepth(p.y);
    this.shadow.setPosition(p.x, p.y - 2).setDepth(p.y - 1);
    // échelle légère selon la profondeur (plus bas = plus proche)
    const k = 0.85 + ((p.y - w.yMin) / Math.max(1, w.yMax - w.yMin)) * 0.3;
    const moving = L || R || U || D;

    if (p instanceof Puppet) {
      if (L) p.setFacing(true);
      if (R) p.setFacing(false);
      p.setDepthScale(k);
      p.step(dt, moving);
    } else {
      if (L) p.setFlipX(true);
      if (R) p.setFlipX(false);
      p.setScale(k * (this.place.playerScale ?? 1));
      if (moving) {
        this.walkT += dt;
        if (this.walkT > 150) {
          this.walkT = 0;
          this.frame = 1 - this.frame;
          p.setTexture(`player_${this.frame}`);
        }
      } else p.setTexture('player_0');
    }
    this.shadow.setScale(k);

    // la caméra glisse un peu devant le joueur, du côté où il marche (pas pendant les dialogues : elle est alors cadrée)
    {
      const cam = this.cameras.main;
      const facing = p instanceof Puppet ? (p.scaleX < 0 ? -1 : 1) : p.flipX ? -1 : 1;
      const want = (moving ? facing : facing * 0.6) * (LOOK_AHEAD / cam.zoom);
      this.look += (want - this.look) * Math.min(1, dt / 600);
      cam.setFollowOffset(-this.look, 0);
    }

    // proximité
    this.near = null;
    let edge: Hotspot | null = null;
    let edgeDir = 0;
    for (const s of this.spots) {
      if (s.h.kind === 'subject') continue;
      const dir = this.edgeDir(s.h);
      if (dir) {
        // sortie au bord : pas d'étiquette, c'est la bannière qui parle quand on s'en approche
        this.promptOn(s.prompt, false);
        if (dir < 0 ? p.x < s.h.x + 230 : p.x > s.h.x - 230) {
          edge = s.h;
          edgeDir = dir;
        }
        continue;
      }
      const close = Phaser.Math.Distance.Between(p.x, p.y, s.h.x, s.h.y) < NEAR;
      this.promptOn(s.prompt, close);
      if (close) this.near = s.h;
    }
    // marcher vers le bord : la bannière se remplit, on sort sans rien presser ; faire demi-tour annule
    if (edge) {
      const toward = edgeDir < 0 ? L : R;
      const away = edgeDir < 0 ? R : L;
      if (toward) this.exitPush += dt;
      else if (away) this.exitPush = 0;
      else this.exitPush = Math.max(0, this.exitPush - dt * 0.5);
      const progress = this.exitPush / 700;
      // en s'éloignant du bord (ou en entrant par lui), pas de bannière
      this.showExitBanner(away ? null : edge, edgeDir, progress);
      if (progress >= 1) {
        this.leaveTo(edge);
        return;
      }
    } else {
      this.exitPush = 0;
      this.showExitBanner(null, 0, 0);
    }
    // arrivé là où l'on avait cliqué : on parle / on entre tout seul
    if (this.clickTarget && this.autoWalk === 0) {
      const h = this.clickTarget;
      this.clickTarget = null;
      if (Phaser.Math.Distance.Between(p.x, p.y, h.x, h.y) < NEAR + 20) {
        this.activate(h);
        return;
      }
    }
    const act = JD(this.keys.SPACE) || JD(this.keys.E) || JD(this.cursors.up) || JD(this.keys.W);
    if (act) {
      if (this.near) this.activate(this.near);
      else if (edge) this.leaveTo(edge);
    }
  }
}
