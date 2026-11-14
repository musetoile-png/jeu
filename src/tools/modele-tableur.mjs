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

import { loadCatalogue } from './catalogue.mjs';
import { ecrireTableur } from './tableur.mjs';

const args = process.argv.slice(2);
const example = args.includes('--exemple');
const baseId = args.includes('--base')
  ? args[args.indexOf('--base') + 1]
  : 'shanghai';
const cat = loadCatalogue(baseId);
const OUT = new URL('../sources/editeurs/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

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
const lessonValues = Object.fromEntries(lesson);
if (example) lessonValues['rédigé par'] = 'Mille li (démonstration)';

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
const name = example ? 'exemple-salon-de-the.xlsx' : 'modele-lecon.xlsx';
const n = await ecrireTableur(join(OUT, name), {
  cat,
  lesson: lessonValues,
  words,
  scenes,
  lines,
});
console.log(
  `✔ sources/editeurs/${name} (${n.places} lieux, ${n.people} personnages au catalogue)`,
);
