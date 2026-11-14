import type { Localized } from './content';

/**
 * Fiche client (marque blanche). Un client = un habillage + un paquet de contenu + un espace de sauvegarde à lui.
 * Le moteur et les paquets ne changent pas : seul ce fichier dit « c'est le jeu de qui ».
 *
 * Fichier : content/clients/<id>/client.json. Choix du client : ?client=<id> dans l'adresse,
 * sinon la variable de build VITE_CLIENT, sinon le client par défaut (Mille li).
 */
export interface Client {
  id: string;
  /** Nom du produit tel que l'élève le voit (titre de l'onglet, en-tête, bilan). */
  name: string;
  /** Marque courte écrite avant le nom (« 千里 »), en police calligraphique ; absente = rien. */
  mark?: string;
  /** L'en-tête reprend le titre du paquet à l'encre du carnet (pâle → noir à mesure qu'on rencontre les mots). */
  inkTitle?: boolean;
  /** Petite ligne après le nom (« Premier soir à Shanghai »). */
  tagline?: Localized;
  /** Description de la page (balise meta). */
  description?: Localized;
  /** Paquet de contenu joué (content/packs/<pack>). */
  pack: string;
  /** Langue de l'interface et des explications (content/ui-strings/<uiLanguage>.json). */
  uiLanguage: string;
  /**
   * Préfixe des données gardées dans le navigateur (carnet, sauvegarde, journal, réglages).
   * Deux clients sur le même site ne mélangent jamais leurs élèves. Ne jamais le changer pour un client en service :
   * les élèves perdraient leur progression.
   */
  storagePrefix: string;
  /** Couleurs et polices de l'interface. Toute clé absente garde la valeur d'origine. */
  theme?: Partial<Record<ThemeKey, string>>;
  /** Feuille de polices supplémentaire (Google Fonts…) chargée au démarrage. */
  fontsUrl?: string;
}

export type ThemeKey =
  | 'paper'
  | 'paper2'
  | 'ink'
  | 'ink2'
  | 'mute'
  | 'accent'
  | 'highlight'
  | 'success'
  | 'display'
  | 'body';

/** Variable CSS (style.css) pilotée par chaque clé du thème. */
const THEME_VARS: Record<ThemeKey, string> = {
  paper: '--paper',
  paper2: '--paper-2',
  ink: '--ink',
  ink2: '--ink-2',
  mute: '--mute',
  accent: '--lantern',
  highlight: '--amber',
  success: '--jade',
  display: '--display',
  body: '--body',
};

export const DEFAULT_CLIENT = 'mille-li';

const clients = import.meta.glob<Client>(
  '../../content/clients/*/client.json',
  { eager: true, import: 'default' },
);

/** Identifiant demandé : ?client=…, puis VITE_CLIENT, puis le client par défaut. */
function requestedId(): string {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get('client');
  } catch {
    /* hors navigateur */
  }
  const env = (import.meta.env as Record<string, string | undefined>)
    .VITE_CLIENT;
  return (fromUrl ?? env ?? DEFAULT_CLIENT).trim().toLowerCase();
}

function find(id: string): Client | undefined {
  return clients[`../../content/clients/${id}/client.json`];
}

function resolve(): Client {
  const id = requestedId();
  const client = find(id);
  if (client) return client;
  // eslint-disable-next-line no-console
  console.warn(`Client inconnu « ${id} » : on ouvre ${DEFAULT_CLIENT}.`);
  const fallback = find(DEFAULT_CLIENT);
  if (!fallback)
    throw new Error(
      `Fiche client manquante : content/clients/${DEFAULT_CLIENT}/client.json`,
    );
  return fallback;
}

/** Le client de cette page (résolu une fois, au chargement). */
export const CLIENT: Client = resolve();

/** Clé de stockage propre au client : storageKey('save') → « jeu-zh-save » pour Mille li. */
export function storageKey(name: string): string {
  return `${CLIENT.storagePrefix}-${name}`;
}

/** Texte d'un champ traduit dans la langue d'interface du client. */
export function clientText(l: Localized | undefined): string {
  return l?.[CLIENT.uiLanguage] ?? l?.fr ?? l?.en ?? '';
}

/** Habille la page aux couleurs du client : onglet, en-tête, couleurs, polices. */
export function applyBranding(client: Client = CLIENT): void {
  document.title = client.name;
  document.documentElement.lang = client.uiLanguage;
  document.documentElement.dataset.client = client.id;
  const description = clientText(client.description);
  if (description)
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', description);
  if (client.theme?.paper)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', client.theme.paper);
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(client.theme ?? {}) as [
    ThemeKey,
    string,
  ][])
    root.setProperty(THEME_VARS[key], value);
  if (client.fontsUrl) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = client.fontsUrl;
    document.head.append(link);
  }
  const h1 = document.querySelector('header h1');
  if (h1) {
    const mark = document.createElement('span');
    mark.className = 'zh';
    mark.textContent = client.mark ?? '';
    mark.hidden = !client.mark && !client.inkTitle;
    const tagline = clientText(client.tagline);
    const small = document.createElement('small');
    small.textContent = tagline ? `· ${tagline}` : '';
    h1.replaceChildren(mark, document.createTextNode(`${client.name} `), small);
  }
}
