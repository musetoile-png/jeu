/**
 * Marionnette de papier (dans l'esprit du théâtre d'ombres 皮影戏) :
 * une seule illustration de profil découpée en buste + deux jambes ; le moteur fait marcher les jambes.
 * Toutes les mesures du gréement viennent du contenu (pack.json → assets.player.rig), en pixels de l'illustration d'origine.
 */
import Phaser from 'phaser';

export interface PuppetLeg {
  key: string;
  pivot: [number, number];
  foot: [number, number];
}
export interface PuppetRig {
  width: number;
  height: number;
  /** Ligne du sol dans l'illustration (bas des chaussures). */
  ground: number;
  /** Axe vertical du personnage. */
  cx: number;
  legs: PuppetLeg[];
}
/**
 * Marche image par image (planche horizontale d'images de même taille, personnage tourné vers la droite),
 * tirée par exemple d'une vidéo. Remplace la marche découpée quand elle est choisie.
 */
export interface WalkSheet {
  /** Clé de l'image de la planche (déclarée dans assets.images). */
  sheet: string;
  frames: number;
  /** Distance parcourue au sol entre deux images, en pixels de la planche : règle la cadence pour que les pieds ne glissent pas. */
  stride: number;
  /** Image affichée à l'arrêt. */
  still?: number;
  /** Axe du buste dans une image (0 à 1, depuis la gauche). */
  axis?: number;
}
export interface PlayerArt {
  walk?: WalkSheet;
  side: string;
  front?: string;
  height?: number;
  rig?: PuppetRig;
}

const DEG = Math.PI / 180;
/** Durée d'un demi-tour (ms) : la silhouette pivote comme une carte de papier, sans saut. */
const TURN_MS = 160;
/** Fondu entre le profil et la vue de face (ms). */
const FACE_MS = 220;
/** Respiration au repos : période (ms) et amplitude (fraction de la hauteur). */
const BREATH_MS = 3400;
const BREATH = 0.007;

export class Puppet extends Phaser.GameObjects.Container {
  private body_: Phaser.GameObjects.Container;
  private torso: Phaser.GameObjects.Image;
  private legs: {
    img: Phaser.GameObjects.Image;
    a0: number;
    len: number;
    pivotY: number;
  }[] = [];
  private front?: Phaser.GameObjects.Image;
  private rig: PuppetRig;
  private u: number;
  private phase = 0;
  private amount = 0;
  private facingLeft = false;
  private depthScale = 1;
  /** Orientation affichée, de -1 (gauche) à 1 (droite) : elle rejoint l'orientation voulue en pivotant. */
  private turn = 1;
  private breath = Math.random() * Math.PI * 2;
  /** Petit tassement à l'arrêt (1 juste après l'arrêt, puis s'efface). */
  private settle = 0;
  private wasMoving = false;
  private talking = false;
  /** Marche image par image (si une planche est fournie et choisie). */
  private walkImg?: Phaser.GameObjects.Image;
  private walkArt?: WalkSheet;
  private walkT = 0;
  private artHeight: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    art: PlayerArt & { rig: PuppetRig },
  ) {
    super(scene, x, y);
    this.rig = art.rig;
    this.artHeight = art.height ?? 600;
    const r = art.rig;
    this.u = (art.height ?? 600) / r.ground;
    this.body_ = scene.add.container(0, 0);
    this.add(this.body_);

    const place = (key: string, ox: number, oy: number) => {
      const img = scene.add.image(
        (ox - r.cx) * this.u,
        (oy - r.ground) * this.u,
        key,
      );
      img.setOrigin(ox / r.width, oy / r.height);
      img.setScale((this.u * r.width) / img.width);
      return img;
    };
    for (const leg of r.legs) {
      const img = place(leg.key, leg.pivot[0], leg.pivot[1]);
      const dx = leg.foot[0] - leg.pivot[0];
      const dy = leg.foot[1] - leg.pivot[1];
      this.legs.push({
        img,
        a0: Math.atan2(dx, dy) / DEG,
        len: Math.hypot(dx, dy),
        pivotY: leg.pivot[1],
      });
      this.body_.add(img);
    }
    this.torso = place(art.side, r.cx, r.ground);
    this.body_.add(this.torso);

    if (art.front && scene.textures.exists(art.front)) {
      const tex = scene.textures.get(art.front).getSourceImage();
      this.front = scene.add
        .image(0, 0, art.front)
        .setOrigin(0.5, 1)
        .setVisible(false)
        .setAlpha(0);
      this.front.setScale((art.height ?? 600) / tex.height);
      this.add(this.front);
    }
    if (art.walk && scene.textures.exists(art.walk.sheet)) {
      const w = art.walk;
      const tex = scene.textures.get(w.sheet);
      const src = tex.getSourceImage();
      const fw = Math.floor(src.width / w.frames);
      // découpe de la planche en images numérotées (une seule fois par texture)
      if (!tex.has('0'))
        for (let i = 0; i < w.frames; i++)
          tex.add(String(i), 0, i * fw, 0, fw, src.height);
      this.walkArt = w;
      this.walkImg = scene.add
        .image(0, 0, w.sheet, String(w.still ?? 0))
        .setOrigin(w.axis ?? 0.5, 1)
        .setVisible(false);
      this.walkImg.setScale(this.artHeight / src.height);
      this.body_.add(this.walkImg);
    }
    this.pose(0);
    scene.add.existing(this);
  }

  /** La marche image par image existe-t-elle pour ce personnage ? */
  get hasFrameWalk() {
    return !!this.walkImg;
  }

  /** Choisit la marche : image par image (true) ou découpée (false). */
  setFrameWalk(on: boolean) {
    if (!this.walkImg) return;
    this.walkImg.setVisible(on);
    this.torso.setVisible(!on);
    for (const l of this.legs) l.img.setVisible(!on);
  }

  private get frameWalk() {
    return !!this.walkImg?.visible;
  }

  /** dt en ms ; moving : le joueur appuie sur une direction ; speed : vitesse au sol (px/s), pour caler les pas. */
  step(dt: number, moving: boolean, speed = 260) {
    if (this.walkImg && this.walkArt && this.frameWalk) {
      const w = this.walkArt;
      const k = this.walkImg.scaleX;
      if (moving)
        this.walkT =
          (this.walkT +
            (speed * dt) / 1000 / (w.stride * k * this.depthScale)) %
          w.frames;
      else this.walkT = w.still ?? 0;
      this.walkImg.setFrame(String(Math.floor(this.walkT) % w.frames));
    }
    // l'amplitude monte et redescend en douceur : départ et arrêt sans à-coup
    const target = moving ? 1 : 0;
    this.amount += (target - this.amount) * Math.min(1, dt / 120);
    if (moving || this.amount > 0.02) this.phase += dt * 0.0105;
    if (this.wasMoving && !moving) this.settle = 1;
    this.wasMoving = moving;
    this.settle = Math.max(0, this.settle - dt / 260);
    this.breath += (dt / BREATH_MS) * Math.PI * 2;
    // demi-tour : l'orientation affichée glisse vers la voulue (en passant par la tranche)
    const want = this.facingLeft ? -1 : 1;
    if (this.turn !== want) {
      const d = (2 * dt) / TURN_MS;
      this.turn =
        Math.abs(want - this.turn) <= d
          ? want
          : this.turn + Math.sign(want - this.turn) * d;
      this.applyScale();
    }
    this.pose(this.amount);
  }

  private pose(m: number) {
    const c = Math.cos(this.phase);
    let lowest = -Infinity;
    for (const leg of this.legs) {
      // angle visé : la jambe dessinée en avant oscille entre l'avant et l'arrière, l'autre en opposition
      const t = m * leg.a0 * c;
      leg.img.setAngle(leg.a0 - t);
      lowest = Math.max(lowest, leg.pivotY + leg.len * Math.cos(t * DEG));
    }
    // le pied le plus bas reste au sol : le rebond du pas en découle tout seul
    const lift = this.frameWalk ? 0 : lowest - this.rig.ground;
    // à l'arrêt, le corps se tasse un instant puis se redresse (le poids se pose)
    const dip = Math.sin(this.settle * Math.PI) * 5;
    this.body_.y = -lift * this.u + dip;
    // en marche, le buste se penche un peu vers l'avant ; au repos, il respire
    this.torso.setAngle(m * (1.6 + 1.2 * Math.sin(this.phase * 2)));
    const still = 1 - m;
    const b = 1 + still * BREATH * Math.sin(this.breath);
    this.torso.scaleY = this.torso.scaleX * b;
    if (this.front)
      this.front.scaleY =
        this.front.scaleX * (1 + BREATH * Math.sin(this.breath));
    if (this.walkImg) this.walkImg.scaleY = this.walkImg.scaleX * b;
  }

  /** instant : sans pivot (entrée dans un lieu). */
  setFacing(left: boolean, instant = false) {
    this.facingLeft = left;
    if (instant) this.turn = left ? -1 : 1;
    this.applyScale();
  }

  /** Orientation voulue (et non celle, peut-être en train de pivoter, qui s'affiche). */
  get facesLeft() {
    return this.facingLeft;
  }

  setDepthScale(k: number) {
    this.depthScale = k;
    this.applyScale();
  }

  private applyScale() {
    // jamais tout à fait zéro : la silhouette reste un trait au milieu du pivot
    const t =
      Math.abs(this.turn) < 0.04 ? 0.04 * Math.sign(this.turn || 1) : this.turn;
    this.setScale(t * this.depthScale, this.depthScale);
  }

  /** De face pendant une conversation, de profil sinon. */
  setTalking(on: boolean) {
    if (!this.front || on === this.talking) return;
    this.talking = on;
    const show = on ? this.front : this.body_;
    const hide = on ? this.body_ : this.front;
    this.scene.tweens.killTweensOf([this.front, this.body_]);
    show.setVisible(true);
    // le personnage se tourne : léger resserrement pendant que les deux vues se fondent l'une dans l'autre
    this.scene.tweens.add({
      targets: show,
      alpha: 1,
      duration: FACE_MS,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: hide,
      alpha: 0,
      duration: FACE_MS,
      ease: 'Sine.easeIn',
      onComplete: () => hide.setVisible(false),
    });
    this.scene.tweens.add({
      targets: this,
      scaleX: this.scaleX * 0.88,
      duration: FACE_MS / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.applyScale();
      },
    });
  }
}
