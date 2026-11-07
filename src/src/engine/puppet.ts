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
export interface PlayerArt {
  side: string;
  front?: string;
  height?: number;
  rig?: PuppetRig;
}

const DEG = Math.PI / 180;

export class Puppet extends Phaser.GameObjects.Container {
  private body_: Phaser.GameObjects.Container;
  private torso: Phaser.GameObjects.Image;
  private legs: { img: Phaser.GameObjects.Image; a0: number; len: number; pivotY: number }[] = [];
  private front?: Phaser.GameObjects.Image;
  private rig: PuppetRig;
  private u: number;
  private phase = 0;
  private amount = 0;
  private facingLeft = false;
  private depthScale = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, art: PlayerArt & { rig: PuppetRig }) {
    super(scene, x, y);
    this.rig = art.rig;
    const r = art.rig;
    this.u = (art.height ?? 600) / r.ground;
    this.body_ = scene.add.container(0, 0);
    this.add(this.body_);

    const place = (key: string, ox: number, oy: number) => {
      const img = scene.add.image((ox - r.cx) * this.u, (oy - r.ground) * this.u, key);
      img.setOrigin(ox / r.width, oy / r.height);
      img.setScale((this.u * r.width) / img.width);
      return img;
    };
    for (const leg of r.legs) {
      const img = place(leg.key, leg.pivot[0], leg.pivot[1]);
      const dx = leg.foot[0] - leg.pivot[0];
      const dy = leg.foot[1] - leg.pivot[1];
      this.legs.push({ img, a0: Math.atan2(dx, dy) / DEG, len: Math.hypot(dx, dy), pivotY: leg.pivot[1] });
      this.body_.add(img);
    }
    this.torso = place(art.side, r.cx, r.ground);
    this.body_.add(this.torso);

    if (art.front && scene.textures.exists(art.front)) {
      const tex = scene.textures.get(art.front).getSourceImage();
      this.front = scene.add.image(0, 0, art.front).setOrigin(0.5, 1).setVisible(false);
      this.front.setScale((art.height ?? 600) / tex.height);
      this.add(this.front);
    }
    this.pose(0);
    scene.add.existing(this);
  }

  /** dt en ms ; moving : le joueur appuie sur une direction. */
  step(dt: number, moving: boolean) {
    // l'amplitude monte et redescend en douceur : départ et arrêt sans à-coup
    const target = moving ? 1 : 0;
    this.amount += (target - this.amount) * Math.min(1, dt / 120);
    if (moving || this.amount > 0.02) this.phase += dt * 0.0105;
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
    const lift = lowest - this.rig.ground;
    this.body_.y = -lift * this.u;
    this.torso.setAngle(m * 1.2 * Math.sin(this.phase * 2));
  }

  setFacing(left: boolean) {
    this.facingLeft = left;
    this.applyScale();
  }

  setDepthScale(k: number) {
    this.depthScale = k;
    this.applyScale();
  }

  private applyScale() {
    this.setScale(this.facingLeft ? -this.depthScale : this.depthScale, this.depthScale);
  }

  /** De face pendant une conversation, de profil sinon. */
  setTalking(on: boolean) {
    if (!this.front) return;
    this.front.setVisible(on);
    this.body_.setVisible(!on);
  }
}
