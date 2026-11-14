/**
 * Catalogue d'un paquet de base : les lieux (décors) et les personnages (dessins) qu'un éditeur peut réutiliser
 * sans rien dessiner. Lu par l'importeur et par le générateur du tableur modèle.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CONTENT = new URL('../content/', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadCatalogue(baseId) {
  const dir = join(CONTENT, 'packs', baseId);
  if (!existsSync(join(dir, 'pack.json')))
    throw new Error(`Paquet de base inconnu « ${baseId} »`);
  const pack = json(join(dir, 'pack.json'));
  const places = new Map();
  for (const id of pack.places) {
    const place = json(join(dir, 'places', `${id}.json`));
    places.set(id, place);
  }
  // personnages : ceux qui parlent dans les scènes de base et qui ont un dessin « debout » quelque part
  const people = new Map();
  for (const f of readdirSync(join(dir, 'scenes'))) {
    const sc = json(join(dir, 'scenes', f));
    for (const [id, a] of Object.entries(sc.actors ?? {})) {
      if (id === 'player' || people.has(id)) continue;
      const sprite = `${id}_stand`;
      if (!pack.assets.images[sprite]) continue;
      people.set(id, {
        id,
        name: a.name,
        label: a.label?.fr ?? '',
        portrait: a.portrait,
        sprite,
      });
    }
  }
  // où chaque dessin apparaît dans les décors de base (échelle et pied de référence)
  for (const place of places.values()) {
    for (const h of place.hotspots ?? []) {
      const p = [...people.values()].find((x) => x.sprite === h.sprite);
      if (p && !p.ref)
        p.ref = {
          place: place.id,
          scale: h.scale ?? 1,
          y: h.y,
          facing: h.facing,
        };
    }
  }
  for (const p of people.values()) if (!p.ref) people.delete(p.id);
  return { pack, places, people, dir };
}
