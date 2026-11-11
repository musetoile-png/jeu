/**
 * Scène « lieu peint » : plans en parallaxe, bande de marche, joueur, points d'interaction.
 * Chaque lieu (cuisine, boutique, aéroport, bureau, monument…) est un fichier place.json ;
 * passer une porte charge le lieu suivant avec une entrée « découverte » (fondu d'encre, cartouche du nom, recul de la caméra).
 */
import Phaser from 'phaser';

import { KEY } from '../constants';
import { initVoices } from '../engine/audio';
import type { Ambient, Content, Entrance, Hotspot, Place, Quest } from '../engine/content';
import { assetUrl, loadContent, t } from '../engine/content';
import { Dialogue } from '../engine/dialogue';
import { keyOutWhite } from '../engine/keyout';
import { ensurePlaceholderPerson, ensurePlaceholderPlane, placeholderKeys } from '../engine/placeholders';
import { Puppet } from '../engine/puppet';
import * as save from '../engine/save';
import * as ui from '../engine/ui';
import * as notebook from '../engine/notebook';
import { log } from '../engine/log';
import { speak, RATE } from '../engine/audio';
import * as sfx from '../engine/sfx';
import { explain, fmt, shuffle } from '../engine/stall';

const SPEED = 260;
const NEAR = 140;
/** La caméra regarde un peu devant le joueur, du côté où il va (px à l'écran). */
const LOOK_AHEAD = 150;
/** Un toucher qui glisse de moins que ça (px du jeu) est un « tap » : il déclenche l'appareil. */
const TAP_SLOP = 48;

/** Un sujet photographiable : point du décor, ou animal qui passe (le chat). */
interface Subject {
  id: string;
  x: number;
  y: number;
  word: string;
  decoys?: string[];
  img?: Phaser.GameObjects.Image;
}

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
  private photo: { x: number; y: number; w: number; h: number; el: HTMLElement; bar: HTMLElement } | null = null;
  /** Légende en cours (trois mots à choisir) ; tant qu'elle est ouverte, le cadre ne bouge plus. */
  private photoQuiz: HTMLElement | null = null;
  /** Où le doigt (ou la souris) s'est posé dans le viseur : sans glisser, c'est un déclenchement. */
  private downAt: { x: number; y: number } | null = null;
  /** Scintillement des sujets pas encore photographiés (et celui qui suit le chat). */
  private sparkles: { img: Phaser.GameObjects.Image; follow?: Phaser.GameObjects.Image }[] = [];
  /** Sujets mobiles présents (le chat), avec leur image. */
  private mobiles: { a: Ambient; img: Phaser.GameObjects.Image }[] = [];
  /** Panneau d'aide de la première photo et son étape affichée. */
  private coach: HTMLElement | null = null;
  private coachPhase: '' | 'out' | 'frame' | 'name' = '';
  /** La scène de fin de la première photo a été lancée dans ce lieu (pas deux fois de suite). */
  private guideScenePlayed = false;
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
    // Mais un raté réseau ne doit pas laisser un décor en papier blanc : on retente deux fois, sans le cache.
    const tries = new Map<string, number>();
    this.load.on('loaderror', (f: Phaser.Loader.File) => {
      const n = tries.get(f.key) ?? 0;
      const path = this.content.pack.assets.images[f.key];
      if (f.type === 'image' && path && n < 2) {
        tries.set(f.key, n + 1);
        console.warn('image ratée, nouvel essai', f.key);
        this.load.image(f.key, `${assetUrl(path)}${assetUrl(path).includes('?') ? '&' : '?'}r=${Date.now()}`);
      } else console.warn('image manquante', f.key);
    });
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
    this.setHint();
    // raccourcis lus à l'événement (un appui bref, entre deux images, ne se perd pas)
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onShortcut(e));
    // clic / toucher : marcher jusque-là ; sur un personnage ou une porte, y aller puis interagir
    // (appareil sorti : le cadre suit le doigt ou la souris ; un tap ou un clic déclenche)
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.photo) {
        if (!this.photoQuiz) {
          this.aimAt(ptr.x, ptr.y);
          this.downAt = { x: ptr.x, y: ptr.y };
        }
        return;
      }
      this.clickTo(ptr.worldX, ptr.worldY);
    });
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      const down = this.downAt;
      this.downAt = null;
      if (!this.photo || this.photoQuiz || !down) return;
      if (Phaser.Math.Distance.Between(down.x, down.y, ptr.x, ptr.y) < TAP_SLOP) this.shoot();
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (this.photo) {
        if (!this.photoQuiz) this.aimAt(ptr.x, ptr.y);
        this.game.canvas.style.cursor = 'crosshair';
        return;
      }
      const over = this.started && !this.busy && this.spotAt(ptr.worldX, ptr.worldY);
      this.game.canvas.style.cursor = over ? 'pointer' : '';
    });
    this.cameras.main.setBackgroundColor('#efe9dc');
    this.events.emit('content-ready', this.content);

    // Raccourci de test : ?lieu=cuisine (et éventuellement &scene=cuisine-cran1) saute l'écran titre et l'arrivée.
    const qs = new URLSearchParams(location.search);
    const jump = qs.get('lieu');
    if (jump && this.content.places.has(jump)) {
      // save.get() fabrique toujours un profil (garçon par défaut) : on teste l'existence d'une vraie partie, et ?corps= l'emporte
      const corps = qs.get('corps');
      if (!save.exists()) save.newGame(corps === 'f' ? 'f' : 'm', this.content.pack.profile?.startItems ?? []);
      else if (corps === 'f' || corps === 'm') save.get().profile.body = corps;
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
  openPanel(which: 'bag' | 'quest' | 'album' | 'photo', focus?: string) {
    if (!this.started || this.busy) return;
    if (which === 'bag') ui.showBag(this.content);
    if (which === 'quest') ui.showQuest(this.content, focus);
    if (which === 'album') ui.showAlbum(this.content);
    if (which === 'photo') this.togglePhoto();
  }

  // ---------- Lieux ----------

  private clearPlace() {
    // chaque objet du lieu emporte ses animations : une animation qui finit sur un objet détruit fige le jeu
    const kill = (o: Phaser.GameObjects.GameObject) => {
      this.tweens.killTweensOf(o);
      o.destroy();
    };
    for (const s of this.spots) {
      kill(s.obj);
      kill(s.prompt);
    }
    for (const o of this.plaques) kill(o);
    this.plaques = [];
    for (const o of this.placeObjects) kill(o);
    this.placeObjects = [];
    for (const t of this.extraTimers) t.remove();
    this.extraTimers = [];
    for (const o of this.extras) kill(o);
    this.extras = [];
    this.mobiles = [];
    for (const sp of this.sparkles) kill(sp.img);
    this.sparkles = [];
    this.guideScenePlayed = false;
    this.planes = [];
    this.spots = [];
  }

  /** Décors restés en papier (raté réseau au démarrage) : on les recharge et on les remplace dès qu'ils arrivent. */
  private retried = new Set<string>();
  private reloadPlanes(keys: string[]) {
    const images = this.content.pack.assets.images;
    const todo = keys.filter((k) => placeholderKeys.has(k) && images[k] && !this.retried.has(k));
    if (!todo.length) return;
    for (const k of todo) {
      this.retried.add(k);
      const k2 = `${k}@retry`;
      this.load.image(k2, `${assetUrl(images[k])}${assetUrl(images[k]).includes('?') ? '&' : '?'}r=${Date.now()}`);
      this.load.once(`filecomplete-image-${k2}`, () => {
        const users = this.children.list.filter((o) => o instanceof Phaser.GameObjects.Image && o.texture.key === k) as Phaser.GameObjects.Image[];
        users.forEach((o) => o.setTexture(k2));
        this.textures.remove(k);
        this.textures.addImage(k, this.textures.get(k2).getSourceImage() as HTMLImageElement);
        placeholderKeys.delete(k);
        users.forEach((o) => o.setTexture(k));
      });
    }
    this.load.start();
  }

  private buildPlace(place: Place, at: Entrance) {
    this.clearPlace();
    this.place = place;
    // après la pose des plans (les textures de secours existent alors) : on retente ceux restés en papier
    this.time.delayedCall(0, () => this.reloadPlanes(place.planes.map((p) => p.image)));
    const { width: W, height: H } = place.size;
    const zoom = place.zoom ?? 1;

    place.planes.forEach((p, i) => {
      // décor pas encore peint : papier de riz et nom du lieu à l'encre
      ensurePlaceholderPlane(this, p.image, W, H, i, place.name[this.content.language.code]);
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
    // un point visible peut en remplacer un autre (même personnage, scène de quête à la place de la scène habituelle)
    const replaced = new Set(place.hotspots.filter((h) => h.replaces && save.matches(h.when)).flatMap((h) => [h.replaces ?? []].flat()));
    const shown = new Set(place.hotspots.filter((h) => save.matches(h.when) && !replaced.has(h.id)).map((h) => h.id));
    for (const h of place.hotspots) {
      if (!shown.has(h.id) || (h.with && !shown.has(h.with))) continue;
      if (h.kind === 'subject') {
        // sujets photo : invisibles hors du viseur
        const obj = this.add.image(h.x, h.y, '__WHITE').setAlpha(0);
        const prompt = this.add.text(0, 0, '').setVisible(false);
        this.spots.push({ h, obj, prompt });
        continue;
      }
      const closed = h.kind === 'exit' && !(h.to && this.content.places.has(h.to));
      // un étal n'a pas de silhouette : c'est l'étal peint du décor ; seule son étiquette apparaît
      const bare = h.kind === 'exit' || h.kind === 'stall';
      const key = h.sprite ?? (h.kind === 'stall' ? '__WHITE' : `spot_${h.kind}`);
      if (!this.textures.exists(key)) ensurePlaceholderPerson(this, key, h.kind === 'npc' ? '#3b5bd6' : '#d6322a');
      // personnage pas encore dessiné : sa silhouette de secours prend la taille du joueur (l'échelle du lieu vaut pour l'illustration)
      const stand = h.kind === 'npc' && placeholderKeys.has(key) ? (this.exitPromptHeight(place) - 40) / this.textures.get(key).getSourceImage().height : undefined;
      const obj = this.add
        .image(h.x, h.y, key)
        .setOrigin(0.5, 1)
        .setDepth(h.behind ? 0.5 : h.y)
        .setScale(stand ?? h.scale ?? 1);
      if (bare) obj.setAlpha(0.001);
      // au repos, un personnage regarde vers le milieu du lieu (là où le joueur circule)
      if (h.kind === 'npc' && h.facing) obj.setFlipX(((this.place.walk.xMin + this.place.walk.xMax) / 2 >= h.x ? 'right' : 'left') !== h.facing);
      // un personnage n'est jamais figé : il respire (étirement très léger depuis les pieds)
      if (h.kind === 'npc') this.tweens.add({ targets: obj, scaleY: obj.scaleY * 1.012, duration: Phaser.Math.Between(1700, 2400), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      // une porte fermée affiche une pancarte en chinois : le verrou est une phrase à lire
      const signLine = this.content.pack.closedSign;
      const signText = closed && signLine ? save.resolveLine(this.content, signLine).map((tk) => (tk[0] === 'w' ? (this.content.lexicon.get(tk[1])?.target ?? '') : tk[0] === 'v' ? '' : tk[1])).join('') : '';
      const stallWord = h.kind === 'stall' && h.word ? this.content.lexicon.get(h.word)?.target : undefined;
      const verb = closed
        ? `${this.content.ui.closed ?? '✕'} ${signText}`
        : h.kind === 'exit'
          ? (this.content.ui.enter ?? '↑')
          : h.kind === 'stall'
            ? `${this.content.ui.enter ?? '↑'} ${stallWord ?? ''}`.trim()
            : this.content.ui.talk;
      const promptY = Math.max(h.y - (bare ? this.exitPromptHeight(place) : obj.displayHeight) - 16, 48);
      const prompt = this.add
        .text(h.x, promptY, ` ${verb} · ${t(this.content, h.prompt)} `, {
          fontFamily: `'Nunito Sans', ${this.content.language.font}`,
          fontSize: '20px',
          color: closed ? '#efe9dc' : '#1b1b2a',
          backgroundColor: closed ? '#5a5a66' : '#ffa23f',
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5)
        .setDepth(3000)
        .setVisible(false)
        .setData('y0', promptY);
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
    this.refreshSparkles();
  }

  /** Personnage posé dans le lieu sans scène à jouer (client qui attend, habitué assis). */
  private static isExtra(h: Hotspot) {
    return h.kind === 'npc' && !h.scene;
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
      // un clic (ou un toucher) sur la bannière fait sortir tout de suite
      this.exitBanner.addEventListener('click', () => {
        const target = this.spots.find((sp) => sp.h.id === this.exitBannerFor)?.h;
        if (target && !this.busy) this.leaveTo(target);
      });
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
      if (h.kind === 'subject' || h.kind === 'object' || World.isExtra(h)) continue;
      const dir = this.edgeDir(h);
      let hit: boolean;
      if (dir < 0) hit = wx < h.x + 90;
      else if (dir > 0) hit = wx > h.x - 90;
      else if (h.kind === 'exit') hit = Math.abs(wx - h.x) < 110 && wy > h.y - this.exitPromptHeight(this.place) && wy < h.y + 60;
      else if (h.kind === 'stall') hit = Math.abs(wx - h.x) < (h.radius ?? NEAR) * 0.8 && wy > h.y - this.exitPromptHeight(this.place) - 40 && wy < h.y + 60;
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
    // un clic au sol dans la zone d'une sortie de bord vaut un clic sur la sortie (avant, on s'arrêtait là, bannière à demi pleine)
    const edgeHit = this.spots.find((s) => {
      const d = this.edgeDir(s.h);
      const zone = s.h.radius ?? 230;
      return d !== 0 && (d < 0 ? wx < s.h.x + zone : wx > s.h.x - zone);
    });
    // … sauf si l'on clique près de quelqu'un à qui parler (小马 devant la sortie de la gare, le guichet…)
    const npcClose = this.spots.some((s) => ((s.h.kind === 'npc' && !World.isExtra(s.h)) || s.h.kind === 'stall') && Math.abs(wx - s.h.x) < (s.h.radius ?? NEAR));
    const h = this.spotAt(wx, wy) ?? (npcClose ? null : edgeHit?.h) ?? null;
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
    const near = h.radius ?? NEAR;
    if (Phaser.Math.Distance.Between(p.x, p.y, h.x, h.y) < near) {
      this.activate(h);
      return;
    }
    const side = Math.sign(p.x - h.x) || -1;
    this.autoWalk = Phaser.Math.Clamp(h.x + side * Math.min(90, near - 40), w.xMin, w.xMax) - p.x;
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
    if (h.kind === 'npc' || h.kind === 'stall') this.openScene(h);
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
    // si l'on parle pendant l'entrée dans un lieu, la mise en scène s'arrête (sinon le panneau resterait caché)
    this.autoWalk = 0;
    this.clickTarget = null;
    if (this.staging) this.stage(false);
    this.busy = true;
    // Le joueur se met de côté pour ne pas masquer son interlocuteur, puis se tourne vers nous.
    const p = this.player;
    const auto = h.id.startsWith('auto:');
    // à l'étal, l'interlocuteur est le commerçant, debout à côté
    const merchant = h.kind === 'stall' ? this.spots.find((s) => s.h.kind === 'npc' && s.h.sprite?.startsWith(sc.npc)) : undefined;
    const who = merchant?.h ?? h;
    // tout près de l'interlocuteur (on l'a presque dépassé au clavier), on reste du côté d'où l'on arrivait :
    // c'est le regard du joueur qui le dit, pas un pixel de part ou d'autre (sinon il sautait de l'autre côté)
    const facingLeft = p instanceof Puppet ? p.scaleX < 0 : (p as Phaser.GameObjects.Sprite).flipX;
    const side = h.playerAt ? Math.sign(h.playerAt) : Math.abs(p.x - who.x) < 120 ? (facingLeft ? 1 : -1) : p.x <= who.x ? -1 : 1;
    // l'écart suit la taille des personnages dans le lieu (petits dans la bouquinerie, grands en cuisine)
    const gap = Math.round(300 * Math.max(0.65, this.place.playerScale ?? 1));
    const x = auto ? p.x : Phaser.Math.Clamp(who.x + (h.playerAt ?? side * gap), this.place.walk.xMin, this.place.walk.xMax);
    // les autres personnages de la scène présents dans le lieu (clients…) entrent aussi dans le cadre
    const cast = Object.keys(sc.actors)
      .filter((a) => a !== sc.npc && a !== 'player')
      .flatMap((a) => this.spots.filter((s) => s.h.kind === 'npc' && s.h.sprite?.startsWith(a)).map((s) => s.h.x));
    // gros plan : la caméra cadre les deux personnages d'un côté, le panneau d'action se pose de l'autre
    const panelSide = this.frameDialogue(auto ? [x, ...cast] : [x, who.x, ...cast], Math.max(p.y, who.y));
    const npcSpot = auto ? undefined : (merchant ?? this.spots.find((s) => s.h.id === h.id));
    this.talkTo = npcSpot?.obj;
    // l'interlocuteur se tourne vers le joueur (si l'on sait de quel côté regarde son dessin)
    const look = npcSpot?.h.facing;
    if (look && npcSpot.obj instanceof Phaser.GameObjects.Image) npcSpot.obj.setFlipX((x > who.x ? 'right' : 'left') !== look);
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
    // le chat est un sujet photo : il scintille quand l'appareil est sorti
    if (a.subject && a.word) {
      this.mobiles.push({ a, img });
      if (this.photo) this.refreshSparkles();
    }
    const speed = a.speed ?? 70;
    const done = () => {
      img.destroy();
      shadow.destroy();
      this.extras = this.extras.filter((o) => o !== img && o !== shadow);
      this.mobiles = this.mobiles.filter((m) => m.img !== img);
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
      this.tweens.add({
        targets: img,
        x: toX,
        duration: (Math.abs(toX - img.x) / speed) * 1000,
        onUpdate: follow,
        onComplete: () => {
          if (img.active) then();
        },
      });

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

  /**
   * Lance une scène sans que le joueur l'ait demandée (scène d'arrivée, prologue). Si un personnage visible porte
   * cette scène (le policier de la gare qui t'arrête), on la joue avec lui : cadrage, bulle au-dessus de sa tête.
   */
  private playScene(id: string) {
    // le personnage qui porte la scène, sinon le même personnage posé là en figurant (小马 derrière son étal)
    const npc = this.content.scenes.get(id)?.npc;
    const h =
      this.spots.find((s) => s.h.kind === 'npc' && s.h.scene === id)?.h ??
      (npc ? (this.spots.find((s) => World.isExtra(s.h) && s.h.sprite?.startsWith(npc)) ?? this.spots.find((s) => s.h.kind === 'npc' && s.h.sprite?.startsWith(npc)))?.h : undefined);
    if (h) this.openScene(h.scene === id ? h : { ...h, scene: id });
    else this.openScene({ id: `auto:${id}`, kind: 'npc', x: this.player.x + 320, y: this.player.y, scene: id, prompt: {} });
  }

  /** Conséquences d'une scène réussie : drapeaux, objets, nouveau lieu, cartouche. */
  private sceneEnd(id: string) {
    const end = this.content.scenes.get(id)?.onEnd;
    if (!end) return;
    if (end.flags) save.setFlags(end.flags);
    // la quête de fond avance (panneau Quête, touche J) ; rejouer la scène ne la fait pas reculer
    if (end.quest && save.setQuestStep(end.quest.id, end.quest.step)) log({ scene: id, step: -1, kind: 'quest_step', detail: `${end.quest.id}=${end.quest.step}` });
    for (const it of end.give ?? []) {
      if (save.hasItem(it)) continue;
      save.addItem(it);
      ui.flyToBag(this.content, it);
      const item = this.content.items.get(it);
      if (item) ui.toast(this.content, item.word, `${this.content.ui.received ?? '+'} ${t(this.content, this.content.lexicon.get(item.word)?.gloss)}`);
      log({ scene: id, step: -1, kind: 'item_get', detail: it, word: item?.word });
    }
    // liste complète : on peut rapporter les courses ; une page d'album est gagnée
    for (const e of ui.checkErrands(this.content)) this.errandReady(e, id);
    if (save.get().quest && end.flags?.prologue) log({ scene: id, step: -1, kind: 'quest_choice', detail: save.get().quest });
    if (end.ending) {
      // fin de chapitre : le monde s'arrête, l'image de fin prend tout l'écran (la sauvegarde est déjà à jour)
      const ending = end.ending;
      this.busy = true;
      this.stage(true);
      sfx.ambience(undefined);
      log({ scene: id, step: -1, kind: 'chapter_end', detail: JSON.stringify(end.flags ?? {}) });
      this.cameras.main.fadeOut(1400, 0x0b, 0x0e, 0x18);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        ui.ending(this.content, ending);
      });
      return;
    }
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
    const g = this.content.pack.photo?.guide;
    // l'appareil acheté : quelques pas vers ce que 小马 montre, pour l'avoir dans le champ
    if (g && id === g.after && g.walkTo !== undefined && this.place.id === g.place && this.player) {
      const w = this.place.walk;
      this.autoWalk = Phaser.Math.Clamp(g.walkTo, w.xMin, w.xMax) - this.player.x;
    }
    // première photo réussie et saluée : la liste de photos s'ouvre
    if (g && id === g.scene) {
      const list = [...this.content.quests.values()].find((e) => e.list?.some((it) => it.subject === g.subject));
      this.time.delayedCall(900, () => this.openPanel('quest', list?.id));
    }
  }

  /** Une liste vient d'atteindre son objectif : journal, et pour une liste à récompense, la page d'album et le toast. */
  private errandReady(e: Quest, scene: string) {
    if (!e.reward) {
      log({ scene, step: -1, kind: 'errand_ready', detail: e.id });
      return;
    }
    if (save.setQuestStep(e.id, 1)) log({ scene, step: -1, kind: 'quest_step', detail: `${e.id}=pret` });
    const first = e.reward.seal.find((tok) => tok[0] === 'w');
    const { n, total } = ui.errandProgress(e);
    sfx.play('item');
    this.time.delayedCall(1200, () => ui.toast(this.content, first?.[1] ?? '', fmt(t(this.content, e.reward?.toast), { n: String(n), total: String(total) })));
  }

  private effect(fx: string) {
    if (fx.startsWith('pick:')) this.cameras.main.flash(180, 255, 200, 120);
    if (fx === 'chao') this.cameras.main.shake(300, 0.004);
    if (fx === 'bowl') this.cameras.main.flash(260, 255, 220, 160);
    if (fx === 'dog') this.dogRuns();
    if (fx === 'dog_jump') this.dogJumps();
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
    // si on a le chien « gueule vide », on voit le portefeuille tomber puis le chien le ramasser
    const pickUp = real && this.textures.exists('dog_vide') && this.textures.exists('item_qianbao');
    const scale = (this.place.playerScale ?? 1) * (real ? 0.85 : 1.4);
    const dog = this.add
      .image(this.place.size.width + 120, p.y + 4, pickUp ? 'dog_vide' : key)
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(1950)
      .setFlipX(!real);
    // assez lent pour qu'on le voie : il arrive en trottant, s'arrête net au portefeuille, repart en courant
    const IN = 2200;
    const PAUSE = pickUp ? 900 : 450;
    const OUT = 2600;
    const bob = this.tweens.add({ targets: dog, y: dog.y - 9, duration: 170, yoyo: true, repeat: -1 });

    if (!pickUp) {
      this.tweens.chain({
        targets: dog,
        tweens: [
          { x: p.x + 60, duration: IN, ease: 'Sine.easeOut' },
          { x: p.x + 40, duration: PAUSE, ease: 'Sine.easeInOut', onStart: () => this.cameras.main.shake(180, 0.002) },
          { x: -220, duration: OUT, ease: 'Sine.easeIn' },
        ],
        onComplete: () => {
          bob.remove();
          dog.destroy();
        },
      });
      return;
    }

    // 1. le portefeuille glisse de la poche et tombe devant le joueur
    const groundX = p.x + 70;
    const wallet = this.add
      .image(p.x + 10, p.y - p.displayHeight * 0.42, 'item_qianbao')
      .setOrigin(0.5, 1)
      .setDisplaySize(95 * scale, 95 * scale)
      .setDepth(1949)
      .setAngle(-20);
    this.placeObjects.push(wallet);
    this.tweens.add({ targets: wallet, x: groundX, duration: 520, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: wallet, y: p.y + 2, angle: 70, duration: 520, ease: 'Bounce.easeOut' });

    // 2. le chien arrive, la gueule juste au-dessus du portefeuille (la tête est au bord gauche de l'image)
    const mouth = dog.displayWidth * 0.43;
    this.tweens.chain({
      targets: dog,
      tweens: [
        { x: groundX + mouth, duration: IN, ease: 'Sine.easeOut' },
        // 3. il plonge la tête, attrape, se redresse
        {
          angle: -14,
          duration: PAUSE / 2,
          ease: 'Sine.easeIn',
          onStart: () => bob.pause(),
          onComplete: () => {
            this.tweens.killTweensOf(wallet);
            wallet.destroy();
            this.placeObjects = this.placeObjects.filter((o) => o !== wallet);
            dog.setTexture('dog');
            this.cameras.main.shake(180, 0.002);
          },
        },
        { angle: 0, duration: PAUSE / 2, ease: 'Sine.easeOut', onComplete: () => bob.resume() },
        // 4. et file au bout de la ruelle
        { x: -220, duration: OUT, ease: 'Sine.easeIn' },
      ],
      onComplete: () => {
        bob.remove();
        dog.destroy();
      },
    });
  }

  /**
   * À la gare, le chien de la ruelle (attrapé par le policier) bondit une dernière fois vers le portefeuille,
   * puis revient s'asseoir, penaud.
   */
  private dogJumps() {
    const dog = this.spots.find((s) => s.h.sprite?.startsWith('dog'))?.obj;
    if (!dog?.active) return;
    const { x, y } = dog;
    this.tweens.killTweensOf(dog);
    const sy = dog.scaleY;
    this.tweens.chain({
      targets: dog,
      tweens: [
        { x: x + 90, y: y - 70, duration: 260, ease: 'Sine.easeOut' },
        { x: x + 150, y, duration: 240, ease: 'Sine.easeIn' },
        { x: x + 130, y: y - 22, duration: 140, yoyo: true },
        { x, duration: 900, delay: 350, ease: 'Sine.easeInOut' },
      ],
      onComplete: () => {
        dog.setPosition(x, y).setScale(dog.scaleX, sy);
        this.tweens.add({ targets: dog, scaleY: sy * 1.012, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      },
    });
  }

  // ---------- Appareil photo ----------

  /** Ligne d'aide en haut de l'image : marcher, ou (appareil sorti) cadrer et déclencher. */
  private setHint() {
    const h = document.getElementById('hint');
    if (h) h.textContent = (this.photo ? this.content.ui.photoHelp : this.content.ui.hintMove) ?? '';
  }

  /**
   * Tiroir de l'appareil : boutons du viseur, légende, aide de la première photo. Sur grand écran il est posé sur l'image ;
   * sur téléphone, sous l'image, en grand, pour que rien ne cache ce qu'on photographie.
   */
  private dock() {
    const stage = document.getElementById('stage') as HTMLElement;
    let d = stage.querySelector<HTMLElement>('#photo-dock');
    if (!d) {
      d = document.createElement('div');
      d.id = 'photo-dock';
      stage.appendChild(d);
    }
    return d;
  }

  private togglePhoto() {
    if (this.photo) {
      this.photo.el.remove();
      this.photo.bar.remove();
      this.photoQuiz?.remove();
      this.photoQuiz = null;
      this.photo = null;
      this.downAt = null;
      this.game.canvas.style.cursor = '';
      this.setHint();
      this.refreshSparkles();
      return;
    }
    const need = this.content.pack.photo?.item;
    if (need && !save.hasItem(need)) {
      const it = this.content.items.get(need);
      if (it) ui.toast(this.content, it.word, this.content.ui.needCamera ?? '');
      return;
    }
    // on s'arrête pour viser
    this.autoWalk = 0;
    this.clickTarget = null;
    this.showExitBanner(null, 0, 0);
    const el = document.createElement('div');
    el.className = 'viewfinder';
    el.innerHTML = `<div class="frame"><i></i></div>`;
    document.getElementById('stage')!.appendChild(el);
    const bar = document.createElement('div');
    bar.className = 'vf-bar';
    const shootBtn = document.createElement('button');
    shootBtn.className = 'go';
    shootBtn.textContent = this.content.ui.photoShoot ?? '📷';
    shootBtn.onclick = () => this.shoot();
    const closeBtn = document.createElement('button');
    closeBtn.textContent = this.content.ui.photoClose ?? '✕';
    closeBtn.onclick = () => this.togglePhoto();
    // au doigt, la ligne d'aide du haut est masquée : le geste est rappelé ici
    const tapHelp = document.createElement('p');
    tapHelp.className = 'vf-help';
    tapHelp.textContent = this.content.ui.photoTap ?? '';
    bar.append(tapHelp, shootBtn, closeBtn);
    this.dock().appendChild(bar);
    this.photo = { x: 640, y: 330, w: 420, h: 300, el, bar };
    this.setHint();
    this.placeFrame();
    this.refreshSparkles();
  }

  /** Le cadre suit la souris ou le doigt (coordonnées du jeu, 1280×720). */
  private aimAt(x: number, y: number) {
    const f = this.photo;
    if (!f) return;
    f.x = Phaser.Math.Clamp(x, f.w / 2, 1280 - f.w / 2);
    f.y = Phaser.Math.Clamp(y, f.h / 2, 720 - f.h / 2);
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

  /** Sujets photographiables du lieu : points du décor, et le chat s'il passe. */
  private subjects(): Subject[] {
    const out: Subject[] = [];
    for (const s of this.spots) if (s.h.kind === 'subject' && s.h.word) out.push({ id: s.h.id, x: s.h.x, y: s.h.y, word: s.h.word, decoys: s.h.decoys });
    for (const m of this.mobiles)
      if (m.img.active && m.a.subject && m.a.word) out.push({ id: m.a.subject, x: m.img.x, y: m.img.y - m.img.displayHeight / 2, word: m.a.word, decoys: m.a.decoys, img: m.img });
    return out;
  }

  /** Le sujet dans le cadre (le plus proche du centre s'il y en a plusieurs). */
  private subjectInFrame(): Subject | undefined {
    const r = this.frameRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return this.subjects()
      .filter((s) => s.x > r.x && s.x < r.x + r.w && s.y > r.y && s.y < r.y + r.h)
      .sort((a, b) => Phaser.Math.Distance.Between(a.x, a.y, cx, cy) - Phaser.Math.Distance.Between(b.x, b.y, cx, cy))[0];
  }

  /** Trois mots pour la légende : le bon, et deux voisins qui partagent un caractère ou un son (déclarés par le sujet). */
  private captionWords(subj: Subject) {
    const word = subj.word;
    const lex = this.content.lexicon;
    const out = (subj.decoys ?? []).filter((w) => w !== word && lex.has(w)).slice(0, 2);
    if (out.length < 2) {
      // repli : des noms déjà rencontrés, ceux qui partagent un caractère d'abord
      const target = lex.get(word)?.target ?? '';
      const known = notebook.all().filter((w) => w !== word && !out.includes(w) && lex.get(w)?.pos === 'n');
      const pool = known.length >= 2 ? known : [...lex.keys()].filter((w) => w !== word && !out.includes(w));
      const shares = (w: string) => [...(lex.get(w)?.target ?? '')].some((c) => target.includes(c));
      out.push(...shuffle(pool).sort((a, b) => Number(shares(b)) - Number(shares(a))).slice(0, 2 - out.length));
    }
    return shuffle([word, ...out]);
  }

  private shoot() {
    if (!this.photo || this.photoQuiz) return;
    this.cameras.main.flash(160, 255, 255, 255);
    sfx.play('tap');
    const subj = this.subjectInFrame();
    const rect = this.frameRect();
    if (!subj) {
      ui.toast(this.content, this.content.items.get(this.content.pack.photo?.item ?? '')?.word ?? '', this.content.ui.photoMiss ?? '');
      return;
    }
    // la photo est prise : on fige le chat tel qu'il était, puis on la légende (le mot parmi trois, lu sans pinyin)
    const extra = subj.img ? { image: subj.img.texture.key, x: subj.img.x, y: subj.img.y, h: subj.img.displayHeight, flip: subj.img.flipX } : undefined;
    const word = subj.word;
    const scene = `photo:${this.place.id}`;
    const q = document.createElement('div');
    q.className = 'photo-quiz';
    const ask = document.createElement('p');
    ask.textContent = this.content.ui.photoName ?? '';
    const row = document.createElement('div');
    row.className = 'picks';
    const why = document.createElement('p');
    why.className = 'why';
    for (const w of this.captionWords(subj)) {
      const b = document.createElement('button');
      b.className = 'pick hanzi';
      b.innerHTML = `<span class="ph"></span>`;
      b.querySelector('.ph')!.textContent = this.content.lexicon.get(w)?.target ?? w;
      b.onclick = () => {
        if (b.disabled) return;
        const ok = w === word;
        if (!ok) {
          // erreur expliquée : ce qui a trompé (caractère commun, ton, son), puis le bon mot
          const ex = explain(this.content, word, w);
          log({ scene, step: 0, kind: 'answer', ok, word, detail: `photo=${subj.id};pick=${w};errorType=${ex.errorType}` });
          notebook.mark(word, false);
          sfx.play('bad');
          b.classList.add('nope');
          b.disabled = true;
          why.textContent = ex.why;
          return;
        }
        log({ scene, step: 0, kind: 'answer', ok, word, detail: `photo=${subj.id};pick=${w}` });
        sfx.play('good');
        const e = this.content.lexicon.get(word);
        if (e) speak(this.content, e.target, `w_${word}`, RATE.WORD);
        notebook.meet(word, `photo:${this.place.id}:${subj.id}`);
        notebook.mark(word, true);
        save.addPhoto({ subject: subj.id, place: this.place.id, word, rect, t: Date.now(), extra });
        log({ scene, step: 0, kind: 'photo_taken', word, detail: subj.id });
        document.dispatchEvent(new CustomEvent('notebook-changed'));
        q.remove();
        this.photoQuiz = null;
        this.afterPhoto(subj);
      };
      row.append(b);
    }
    q.append(ask, row, why);
    this.dock().appendChild(q);
    this.photoQuiz = q;
  }

  /** Photo rangée : la ligne de la liste se coche, l'objectif peut être atteint, la première photo est saluée. */
  private afterPhoto(subj: Subject) {
    const list = [...this.content.quests.values()].find(
      (e) => e.kind === 'errand' && e.list?.some((it) => it.subject === subj.id) && save.hasItem(e.item) && save.matches(e.when),
    );
    const prog = list ? ui.errandProgress(list) : undefined;
    ui.toast(this.content, subj.word, prog ? fmt(this.content.ui.photoTicked ?? '', { n: String(prog.n), total: String(prog.total) }) : (this.content.ui.photoSaved ?? ''));
    for (const e of ui.checkErrands(this.content)) this.errandReady(e, `photo:${this.place.id}`);
    this.refreshSparkles();
    this.placeFrame();
    // première photo : on range l'appareil, 小马 va réagir
    const g = this.guide();
    if (g && subj.id === g.subject)
      this.time.delayedCall(900, () => {
        if (this.photo) this.togglePhoto();
      });
  }

  /** Première photo guidée en cours dans ce lieu ? */
  private guide() {
    const g = this.content.pack.photo?.guide;
    const need = this.content.pack.photo?.item;
    return g && this.place?.id === g.place && save.matches(g.when) && (!need || save.hasItem(need)) ? g : undefined;
  }

  /** Panneau d'aide de la première photo : sortir l'appareil, cadrer et déclencher, légender. */
  private updateCoach() {
    const g = this.guide();
    let phase: '' | 'out' | 'frame' | 'name' = '';
    if (g && !save.hasPhoto(g.subject) && !this.busy && !this.staging && !this.pendingScene && this.autoWalk === 0 && !ui.panelOpen())
      phase = !this.photo ? 'out' : this.photoQuiz ? 'name' : 'frame';
    if (phase === this.coachPhase) return;
    this.coachPhase = phase;
    this.coach?.remove();
    this.coach = null;
    this.refreshSparkles();
    if (!g || !phase) return;
    const ui0 = this.content.ui;
    const target = this.content.lexicon.get(this.spots.find((s) => s.h.id === g.subject)?.h.word ?? '')?.target ?? '';
    const c = document.createElement('div');
    c.className = 'coach';
    const steps = ['out', 'frame', 'name'];
    const head = document.createElement('div');
    head.className = 'coach-head';
    const title = document.createElement('b');
    title.textContent = ui0.guideTitle ?? '';
    const dots = document.createElement('span');
    dots.className = 'coach-steps';
    for (const st of steps) dots.append(Object.assign(document.createElement('i'), { className: st === phase ? 'on' : steps.indexOf(st) < steps.indexOf(phase) ? 'ok' : '' }));
    head.append(title, dots);
    const text = document.createElement('p');
    text.textContent = fmt(t(this.content, g.text[phase]), { word: target });
    c.append(head, text);
    if (phase === 'out') {
      const b = document.createElement('button');
      b.className = 'go';
      b.textContent = ui0.guideOutBtn ?? '📷';
      b.onclick = () => this.openPanel('photo');
      c.append(b);
    }
    this.dock().prepend(c);
    this.coach = c;
  }

  /** Une petite étoile d'encre dorée, dessinée une fois. */
  private sparkleKey() {
    const key = 'photo_sparkle';
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, 64, 64)!;
    const c = tex.getContext();
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
    g.addColorStop(0.35, 'rgba(255, 196, 90, 0.45)');
    g.addColorStop(1, 'rgba(255, 196, 90, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#fffaf0';
    c.beginPath();
    c.moveTo(32, 4);
    c.quadraticCurveTo(35, 29, 60, 32);
    c.quadraticCurveTo(35, 35, 32, 60);
    c.quadraticCurveTo(29, 35, 4, 32);
    c.quadraticCurveTo(29, 29, 32, 4);
    c.fill();
    tex.refresh();
    return key;
  }

  /**
   * Repère discret : appareil sorti, les sujets pas encore photographiés scintillent (pas ceux déjà dans l'album).
   * Pendant la première photo, le sujet montré par 小马 scintille même appareil rangé.
   */
  private refreshSparkles() {
    for (const sp of this.sparkles) {
      this.tweens.killTweensOf(sp.img);
      sp.img.destroy();
    }
    this.sparkles = [];
    if (!this.place || !this.started) return;
    const g = this.guide();
    const add = (x: number, y: number, big: boolean, follow?: Phaser.GameObjects.Image) => {
      const img = this.add.image(x, y, this.sparkleKey()).setDepth(2600).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.15).setScale(big ? 0.8 : 0.5);
      this.tweens.add({ targets: img, alpha: big ? 0.9 : 0.7, scale: big ? 1.2 : 0.8, angle: 45, duration: big ? 700 : 900, yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 600), ease: 'Sine.easeInOut' });
      this.sparkles.push({ img, follow });
    };
    for (const s of this.subjects()) {
      if (save.hasPhoto(s.id)) continue;
      const guided = !!g && g.subject === s.id;
      if (this.photo || guided) add(s.x, s.y, guided && !this.photo, s.img);
    }
  }

  /** Sac, quête, album, appareil, son, Échap ; appareil sorti : Espace déclenche, 1 2 3 légendent. */
  private onShortcut(e: KeyboardEvent) {
    if (!this.started || this.busy || e.repeat) return;
    if (this.photo && e.code === 'Space') {
      if (!this.photoQuiz) this.shoot();
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (this.photoQuiz && digit) {
      this.photoQuiz.querySelectorAll<HTMLButtonElement>('button.pick')[Number(digit[1]) - 1]?.click();
      return;
    }
    if (e.code === 'KeyI') ui.panelOpen() ? ui.closePanel() : this.openPanel('bag');
    if (e.code === 'KeyJ') ui.panelOpen() ? ui.closePanel() : this.openPanel('quest');
    if (e.code === 'KeyO') ui.panelOpen() ? ui.closePanel() : this.openPanel('album');
    if (e.code === 'KeyP') this.togglePhoto();
    if (e.code === 'KeyM') document.dispatchEvent(new CustomEvent('toggle-sound'));
    if (e.code === 'Escape') {
      ui.closePanel();
      if (this.photo) this.togglePhoto();
    }
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
    // le scintillement suit le chat ; il s'éteint quand le chat est parti
    for (const sp of this.sparkles)
      if (sp.follow) {
        if (sp.follow.active) sp.img.setPosition(sp.follow.x, sp.follow.y - sp.follow.displayHeight / 2);
        else sp.img.setVisible(false);
      }
    this.updateCoach();
    // première photo réussie (même si la partie a été fermée entre-temps) : 小马 réagit
    const g = this.guide();
    if (g && !this.guideScenePlayed && save.hasPhoto(g.subject) && !this.busy && !this.photo && !ui.panelOpen() && !this.staging && !this.pendingScene && this.autoWalk === 0) {
      this.guideScenePlayed = true;
      this.playScene(g.scene);
      return;
    }
    if (this.photo) {
      // viseur : les flèches déplacent le cadre, Espace déclenche ; légende ouverte : 1, 2, 3 choisissent
      const f = this.photo;
      if (!this.photoQuiz) {
        const sp = 0.5 * dt;
        if (this.cursors.left.isDown || this.keys.A.isDown) f.x = Math.max(f.w / 2, f.x - sp);
        if (this.cursors.right.isDown || this.keys.D.isDown) f.x = Math.min(1280 - f.w / 2, f.x + sp);
        if (this.cursors.up.isDown || this.keys.W.isDown) f.y = Math.max(f.h / 2, f.y - sp);
        if (this.cursors.down.isDown || this.keys.S.isDown) f.y = Math.min(720 - f.h / 2, f.y + sp);
        this.placeFrame();
      }
      // Espace : déclencher ; 1, 2, 3 : légender (voir onShortcut) ; la touche ne fait pas aussi « parler »
      JD(this.keys.SPACE);
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
    // un appui très bref (appuyé et relâché entre deux images, surtout sur une machine lente) compte quand même pour un pas
    let L = this.cursors.left.isDown || this.keys.A.isDown || JD(this.cursors.left) || JD(this.keys.A);
    let R = this.cursors.right.isDown || this.keys.D.isDown || JD(this.cursors.right) || JD(this.keys.D);
    const U = this.cursors.up.isDown || this.keys.W.isDown;
    const D = this.cursors.down.isDown || this.keys.S.isDown;
    // marche d'entrée : quelques pas tout seul, interrompue dès que le joueur prend la main
    // (le compteur suit la distance réellement parcourue : avant, il baissait à 0,8 × la vitesse et un clic lointain
    // menait 25 % trop loin, au-delà du personnage ou de l'étal visé, qui ne s'ouvrait pas)
    let autoLeft = Infinity;
    if (this.autoWalk !== 0) {
      if (L || R || U || D) {
        this.autoWalk = 0;
        this.clickTarget = null;
      } else {
        R = this.autoWalk > 0;
        L = this.autoWalk < 0;
        autoLeft = Math.abs(this.autoWalk);
        const stepPx = SPEED * (dt / 1000);
        this.autoWalk = autoLeft <= stepPx ? 0 : this.autoWalk - Math.sign(this.autoWalk) * stepPx;
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
    const vx = ((R ? 1 : 0) - (L ? 1 : 0)) * Math.min(SPEED * (dt / 1000), autoLeft);
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
      // un personnage dont on connaît le sens du dessin suit le joueur du regard
      if (s.h.facing && s.obj instanceof Phaser.GameObjects.Image && Math.abs(p.x - s.h.x) > 40) s.obj.setFlipX((p.x > s.h.x ? 'right' : 'left') !== s.h.facing);
      if (s.h.kind === 'subject' || World.isExtra(s.h)) continue;
      const dir = this.edgeDir(s.h);
      if (dir) {
        // sortie au bord : pas d'étiquette, c'est la bannière qui parle quand on s'en approche
        this.promptOn(s.prompt, false);
        const zone = s.h.radius ?? 230;
        if (dir < 0 ? p.x < s.h.x + zone : p.x > s.h.x - zone) {
          edge = s.h;
          edgeDir = dir;
        }
        continue;
      }
      const close = Phaser.Math.Distance.Between(p.x, p.y, s.h.x, s.h.y) < (s.h.radius ?? NEAR);
      this.promptOn(s.prompt, close);
      if (close) this.near = s.h;
    }
    // marcher vers le bord : la bannière se remplit, on sort sans rien presser ; faire demi-tour annule
    if (edge) {
      const toward = edgeDir < 0 ? L : R;
      const away = edgeDir < 0 ? R : L;
      // on avance vers le bord : la jauge monte (deux fois plus vite si l'on bute déjà contre le bord du lieu) ;
      // on s'arrête : elle reste où elle est (avant, elle se vidait et l'on restait coincé sur la bannière) ;
      // on fait demi-tour : elle retombe à zéro
      const atBound = edgeDir < 0 ? p.x <= w.xMin + 1 : p.x >= w.xMax - 1;
      if (toward) this.exitPush += atBound ? dt * 2 : dt;
      else if (away) this.exitPush = 0;
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
      if (Phaser.Math.Distance.Between(p.x, p.y, h.x, h.y) < (h.radius ?? NEAR) + 20) {
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
