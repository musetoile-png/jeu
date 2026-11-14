/**
 * Écriture du tableur de leçon (onglets Leçon, Mots, Scènes, Répliques, Catalogue, et Relecture pour un brouillon).
 * Partagé par le modèle vide (modele-tableur.mjs) et par le générateur (generer.mjs) : un seul format de tableur,
 * relu ensuite par l'importeur (import.mjs).
 */
import ExcelJS from 'exceljs';

const HEAD = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5FA8' } },
};
const TODO = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
};

export const ERREURS = [
  'sens',
  'usage',
  'grammaire',
  'classificateur',
  'son',
  'caractère',
  'nombre',
  'ordre',
];

/** Champs de l'onglet Leçon, dans l'ordre, avec leur aide. */
export const CHAMPS_LECON = [
  [
    'identifiant',
    'minuscules, chiffres et tirets : devient le nom du paquet (ex. editeur-lecon-3)',
  ],
  ['titre', 'titre de la leçon, en français'],
  [
    'titre en langue cible',
    'le même titre dans la langue apprise (affiché en grand sur l’écran titre)',
  ],
  ['transcription du titre', 'pinyin du titre'],
  ['sous-titre', 'petite ligne sous le titre (facultatif)'],
  ['langue', 'langue apprise : zh pour le chinois'],
  ['paquet de base', 'décors et personnages réutilisés : ne pas changer'],
  [
    'rédigé par',
    'qui a écrit ce tableur (un nom, ou « IA (brouillon) » s’il sort du générateur)',
  ],
  [
    'relu par',
    'nom de l’enseignant qui a relu et validé la leçon : obligatoire pour importer un brouillon de l’IA',
  ],
];

/**
 * @param {string} path fichier .xlsx à écrire
 * @param {object} d
 * @param {object} d.cat catalogue du paquet de base (catalogue.mjs)
 * @param {Record<string,string>} d.lesson valeurs des champs de CHAMPS_LECON
 * @param {string[][]} d.words lignes Mots
 * @param {any[][]} d.scenes lignes Scènes
 * @param {string[][]} d.lines lignes Répliques
 * @param {string[][]} [d.relecture] lignes [catégorie, point, détail] : ajoute l'onglet Relecture (brouillon)
 */
export async function ecrireTableur(path, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mille li';

  function addSheet(name, columns, rows, notes) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = columns.map(([header, width]) => ({ header, width }));
    ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
    for (const r of rows) ws.addRow(r);
    notes?.forEach((n, i) => (ws.getRow(1).getCell(i + 1).note = n));
    return ws;
  }

  // ---------- Relecture (brouillon de l'IA : en premier, c'est ce que l'enseignant doit voir d'abord) ----------
  if (d.relecture) {
    const rl = addSheet(
      'Relecture',
      [
        ['À vérifier', 22],
        ['Point', 60],
        ['Détail', 70],
        ['Fait', 8],
      ],
      d.relecture.map((r) => [...r, '']),
      [
        'catégorie',
        'ce que l’enseignant doit regarder',
        'précisions',
        'cocher (x) une fois vérifié',
      ],
    );
    rl.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
    rl.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  }

  // ---------- Leçon ----------
  const ls = addSheet(
    'Leçon',
    [
      ['Champ', 26],
      ['Valeur', 50],
      ['Aide', 80],
    ],
    CHAMPS_LECON.map(([k, aide]) => [k, d.lesson[k] ?? '', aide]),
  );
  const reluRow = CHAMPS_LECON.findIndex(([k]) => k === 'relu par') + 2;
  if (d.relecture && !d.lesson['relu par'])
    Object.assign(ls.getRow(reluRow).getCell(2), TODO);

  // ---------- Mots ----------
  addSheet(
    'Mots',
    [
      ['Mot', 14],
      ['Transcription', 16],
      ['Traduction', 42],
      ['Nature', 12],
      ['Niveau', 10],
      ['Identifiant', 16],
    ],
    d.words,
    [
      'Le mot tel qu’il s’écrit (caractères)',
      'pinyin avec les tons',
      'sens en français',
      'facultatif (nom, verbe…)',
      'facultatif (HSK1…)',
      'facultatif : laissé vide, il est fabriqué à partir du pinyin',
    ],
  );

  // ---------- Scènes ----------
  const ss = addSheet(
    'Scènes',
    [
      ['Scène', 16],
      ['Titre', 32],
      ['Lieu', 14],
      ['Personnage', 14],
      ['Nom affiché', 14],
      ['Rôle', 24],
      ['Après', 16],
      ['Patience', 10],
    ],
    d.scenes,
    [
      'identifiant court : minuscules, chiffres, tirets',
      'titre de la scène, en français',
      'un lieu de l’onglet Catalogue',
      'un personnage de l’onglet Catalogue',
      'facultatif : son nom dans la langue apprise (sinon celui du catalogue)',
      'facultatif : qui il est, en français',
      'facultatif : la scène qui doit être finie avant (sinon : la ligne du dessus)',
      'nombre d’erreurs tolérées avant l’aide (1 à 5, 3 par défaut)',
    ],
  );

  // ---------- Répliques ----------
  const cols = [
    ['Scène', 14],
    ['Type', 8],
    ['Qui', 10],
    ['Texte', 30],
    ['Traduction', 34],
    ['Consigne', 38],
  ];
  for (const k of [1, 2, 3])
    cols.push(
      [`Faux ${k}`, 22],
      [`Traduction faux ${k}`, 26],
      [`Pourquoi faux ${k}`, 46],
      [`Erreur faux ${k}`, 14],
    );
  const rs = addSheet('Répliques', cols, d.lines, [
    'la scène (onglet Scènes) ; les lignes se jouent dans l’ordre',
    '« dit » : une réplique ; « choix » : une question, l’élève choisit sa réponse',
    'dit : le personnage de la scène (ou « joueur ») ; choix : « joueur »',
    'dit : la phrase ; choix : la BONNE réponse. Écrire normalement : le tableur la découpe en mots',
    'traduction française de la colonne Texte',
    'choix : ce qu’on demande à l’élève, en français',
    'une mauvaise réponse plausible',
    'sa traduction',
    'pourquoi c’est faux : l’élève le lira',
    `le type d’erreur (${ERREURS.join(', ')}) : il nourrit le bilan et la recherche`,
  ]);

  // ---------- Catalogue ----------
  const cs = wb.addWorksheet('Catalogue');
  cs.columns = [
    { header: 'Lieu', width: 16 },
    { header: 'Nom du lieu', width: 32 },
    { header: '', width: 4 },
    { header: 'Personnage', width: 16 },
    { header: 'Nom', width: 14 },
    { header: 'Qui', width: 34 },
  ];
  cs.getRow(1).eachCell((c) => c.value && Object.assign(c, HEAD));
  const places = [...d.cat.places.values()];
  const people = [...d.cat.people.values()];
  for (let i = 0; i < Math.max(places.length, people.length); i++) {
    const p = places[i];
    const q = people[i];
    cs.addRow([
      p?.id ?? '',
      p?.name?.fr ?? '',
      '',
      q?.id ?? '',
      q?.name ?? '',
      q?.label ?? '',
    ]);
  }

  // listes déroulantes
  for (let r = 2; r <= 300; r++) {
    ss.getCell(`C${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`Catalogue!$A$2:$A$${places.length + 1}`],
    };
    ss.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`Catalogue!$D$2:$D$${people.length + 1}`],
    };
    rs.getCell(`B${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"dit,choix"'],
    };
    for (const col of ['J', 'N', 'R'])
      rs.getCell(`${col}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${ERREURS.join(',')}"`],
      };
  }

  await wb.xlsx.writeFile(path);
  return { places: places.length, people: people.length };
}
