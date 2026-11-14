#!/usr/bin/env node
/**
 * Fabrique le tableur modèle à remettre à un éditeur ou à un prof (sources/editeurs/modele-lecon.xlsx),
 * avec l'onglet Catalogue (lieux et personnages réutilisables) et des listes déroulantes.
 *
 * Usage : node tools/modele-tableur.mjs [--exemple] [--base shanghai]
 *   --exemple : remplit le tableur avec la leçon de démonstration « Éditions Exemple » (sources/editeurs/exemple-salon-de-the.xlsx).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

import { loadCatalogue } from './catalogue.mjs';

const args = process.argv.slice(2);
const example = args.includes('--exemple');
const baseId = args.includes('--base')
  ? args[args.indexOf('--base') + 1]
  : 'shanghai';
const cat = loadCatalogue(baseId);
const OUT = new URL('../sources/editeurs/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const wb = new ExcelJS.Workbook();
wb.creator = 'Mille li';
const HEAD = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5FA8' } },
};

function addSheet(name, columns, rows, notes) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  for (const r of rows) ws.addRow(r);
  notes?.forEach((n, i) => (ws.getRow(1).getCell(i + 1).note = n));
  return ws;
}

// ---------- Leçon ----------
const lesson = example
  ? [
      ['identifiant', 'editions-exemple-the'],
      ['titre', 'Boire un thé'],
      ['titre en langue cible', '喝茶'],
      ['transcription du titre', 'hē chá'],
      ['sous-titre', 'Éditions Exemple · Chinois, première année · leçon 3'],
      ['langue', 'zh'],
      ['paquet de base', baseId],
    ]
  : [
      ['identifiant', ''],
      ['titre', ''],
      ['titre en langue cible', ''],
      ['transcription du titre', ''],
      ['sous-titre', ''],
      ['langue', 'zh'],
      ['paquet de base', baseId],
    ];
const ls = addSheet(
  'Leçon',
  [
    ['Champ', 26],
    ['Valeur', 50],
    ['Aide', 80],
  ],
  lesson.map((r) => [...r]),
);
const help = [
  'minuscules, chiffres et tirets : devient le nom du paquet (ex. editeur-lecon-3)',
  'titre de la leçon, en français',
  'le même titre dans la langue apprise (affiché en grand sur l’écran titre)',
  'pinyin du titre',
  'petite ligne sous le titre (facultatif)',
  'langue apprise : zh pour le chinois',
  'décors et personnages réutilisés : ne pas changer',
];
help.forEach((h, i) => (ls.getRow(i + 2).getCell(3).value = h));

// ---------- Mots ----------
const words = example
  ? [
      ['你好', 'nǐ hǎo', 'bonjour'],
      ['请', 'qǐng', 'je t’en prie, s’il te plaît'],
      ['坐', 'zuò', 's’asseoir'],
      ['谢谢', 'xièxie', 'merci'],
      ['不客气', 'bú kèqi', 'de rien'],
      ['再见', 'zàijiàn', 'au revoir'],
      ['你', 'nǐ', 'tu, toi'],
      ['喝', 'hē', 'boire'],
      ['什么', 'shénme', 'quoi'],
      ['我', 'wǒ', 'je, moi'],
      ['要', 'yào', 'vouloir'],
      ['一', 'yī', 'un'],
      ['杯', 'bēi', 'tasse, verre (classificateur des boissons)'],
      ['个', 'ge', '(classificateur général)'],
      ['绿茶', 'lǜchá', 'thé vert'],
      ['红茶', 'hóngchá', '« thé rouge » = thé noir'],
      ['好', 'hǎo', 'bien, d’accord'],
      ['很', 'hěn', 'très'],
      ['热', 'rè', 'chaud'],
      ['十', 'shí', 'dix'],
      ['块', 'kuài', 'yuan (monnaie parlée)'],
      ['多少', 'duōshao', 'combien'],
      ['钱', 'qián', 'argent'],
      ['这', 'zhè', 'ceci'],
      ['是', 'shì', 'être'],
      ['吗', 'ma', '(particule interrogative)'],
      ['对不起', 'duìbuqǐ', 'pardon'],
      ['明天', 'míngtiān', 'demain'],
      ['见', 'jiàn', 'voir (明天见 : à demain)'],
      ['苹果', 'píngguǒ', 'pomme'],
      ['香蕉', 'xiāngjiāo', 'banane'],
      ['不', 'bù', 'ne … pas'],
      ['好吃', 'hǎochī', 'bon (au goût)'],
    ]
  : [];
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
  words,
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
const scenes = example
  ? [
      [
        'the-accueil',
        'Le salon de thé de 陈爷爷',
        'cour',
        'chen',
        '',
        '',
        '',
        3,
      ],
      ['the-payer', 'Payer son thé', 'cour', 'chen', '', '', '', 3],
      ['fruits-li', 'Les fruits de 李叔叔', 'cour', 'li', '', '', '', 3],
    ]
  : [];
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
  scenes,
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
const lines = example
  ? [
      ['the-accueil', 'dit', 'chen', '你好！请坐。', 'Bonjour ! Assieds-toi.'],
      [
        'the-accueil',
        'choix',
        'joueur',
        '谢谢！',
        'Merci !',
        'Il t’invite à t’asseoir. Réponds poliment :',
        '不客气！',
        'De rien !',
        '不客气 répond à un merci : « de rien ». Pour remercier : 谢谢.',
        'usage',
        '再见！',
        'Au revoir !',
        '再见, c’est pour partir : tu viens d’arriver !',
        'usage',
      ],
      ['the-accueil', 'dit', 'chen', '你喝什么？', 'Qu’est-ce que tu bois ?'],
      [
        'the-accueil',
        'choix',
        'joueur',
        '我要一杯绿茶。',
        'Je voudrais une tasse de thé vert.',
        'Commande un thé vert :',
        '我要一杯红茶。',
        'Je voudrais une tasse de thé noir.',
        '红茶, le « thé rouge », c’est le thé noir. Le thé vert : 绿茶.',
        'sens',
        '我要一个绿茶。',
        '(Je voudrais un thé vert, mal compté.)',
        'Une boisson se compte en tasses : 一杯, pas 一个.',
        'classificateur',
      ],
      [
        'the-accueil',
        'dit',
        'chen',
        '好。绿茶很热！',
        'D’accord. Le thé vert est très chaud !',
      ],
      [
        'the-payer',
        'dit',
        'chen',
        '绿茶十块。',
        'Le thé vert, c’est dix yuans.',
      ],
      [
        'the-payer',
        'choix',
        'joueur',
        '多少钱？',
        'Combien ?',
        'Tu n’as pas bien entendu. Redemande le prix :',
        '这是什么？',
        'Qu’est-ce que c’est ?',
        '这是什么 demande ce qu’est une chose. Pour le prix : 多少钱.',
        'sens',
        '你好吗？',
        'Comment vas-tu ?',
        '你好吗 demande des nouvelles. Pour le prix : 多少钱.',
        'sens',
      ],
      ['the-payer', 'dit', 'chen', '十块。', 'Dix yuans.'],
      [
        'the-payer',
        'choix',
        'joueur',
        '谢谢，再见！',
        'Merci, au revoir !',
        'Tu as payé. Remercie et dis au revoir :',
        '对不起，再见！',
        'Pardon, au revoir !',
        '对不起, c’est pour s’excuser. Pour remercier : 谢谢.',
        'usage',
      ],
      ['the-payer', 'dit', 'chen', '再见！明天见！', 'Au revoir ! À demain !'],
      [
        'fruits-li',
        'dit',
        'li',
        '你好！你要苹果吗？',
        'Bonjour ! Tu veux des pommes ?',
      ],
      [
        'fruits-li',
        'choix',
        'joueur',
        '我要香蕉。',
        'Je voudrais des bananes.',
        'Tu préfères les bananes. Dis-le :',
        '我要苹果。',
        'Je voudrais des pommes.',
        '苹果, ce sont les pommes. Les bananes : 香蕉.',
        'sens',
        '我不要。',
        'Je n’en veux pas.',
        '不要 = je n’en veux pas. Toi, tu veux des bananes : 我要香蕉.',
        'sens',
      ],
      [
        'fruits-li',
        'dit',
        'li',
        '好！香蕉很好吃。',
        'D’accord ! Les bananes sont très bonnes.',
      ],
    ]
  : [];
const rs = addSheet(
  'Répliques',
  [
    ['Scène', 14],
    ['Type', 8],
    ['Qui', 10],
    ['Texte', 30],
    ['Traduction', 34],
    ['Consigne', 38],
    ['Faux 1', 22],
    ['Traduction faux 1', 26],
    ['Pourquoi faux 1', 46],
    ['Erreur faux 1', 14],
    ['Faux 2', 22],
    ['Traduction faux 2', 26],
    ['Pourquoi faux 2', 46],
    ['Erreur faux 2', 14],
    ['Faux 3', 22],
    ['Traduction faux 3', 26],
    ['Pourquoi faux 3', 46],
    ['Erreur faux 3', 14],
  ],
  lines,
  [
    'la scène (onglet Scènes) ; les lignes se jouent dans l’ordre',
    '« dit » : une réplique ; « choix » : une question, l’élève choisit sa réponse',
    'dit : le personnage de la scène (ou « joueur ») ; choix : « joueur »',
    'dit : la phrase ; choix : la BONNE réponse. Écrire normalement : le tableur la découpe en mots',
    'traduction française de la colonne Texte',
    'choix : ce qu’on demande à l’élève, en français',
    'une mauvaise réponse plausible',
    'sa traduction',
    'pourquoi c’est faux : l’élève le lira',
    'le type d’erreur (sens, usage, grammaire, classificateur, son, caractère, nombre, ordre) : il nourrit le bilan et la recherche',
  ],
);

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
const places = [...cat.places.values()];
const people = [...cat.people.values()];
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
      formulae: [
        '"sens,usage,grammaire,classificateur,son,caractère,nombre,ordre"',
      ],
    };
}

const name = example ? 'exemple-salon-de-the.xlsx' : 'modele-lecon.xlsx';
await wb.xlsx.writeFile(join(OUT, name));
console.log(
  `✔ sources/editeurs/${name} (${places.length} lieux, ${people.length} personnages au catalogue)`,
);
