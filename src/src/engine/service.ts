/**
 * Service (commandes, cuisine, caisse) : calculs et lignes, sans affichage ni son.
 * Aucun mot de la langue cible ici : les montants dits viennent de `pack.money`, les plats des tickets.
 */
import type { Content, Localized, Said, Ticket, Token } from './content';
import { lineText } from './content';
import { fmt } from './stall';

/** Ce que le joueur a coché : pour chaque élément du ticket, l'option choisie dans chaque case. */
export type TicketPicks = number[][];

/** Un montant dit (« 两块 », « 十四块 ») ; un nombre sans mots déclarés reste en chiffres. */
export function moneyLine(content: Content, n: number): Token[] {
  const m = content.pack.money;
  const words = m?.words[String(n)] ?? [['t', String(n), '', String(n)] as Token];
  return m ? [...words, m.unit] : words;
}

export const moneyText = (content: Content, n: number) => lineText(content, moneyLine(content, n));

/** Réplique avec un montant : la place ["v", "AMOUNT"] reçoit le montant dit ; {n} dans la voix et la glose. */
export function withAmount(content: Content, l: Said, n: number): Said & { gloss: Localized } {
  const line = l.line.flatMap((x): Token[] => (x[0] === 'v' && x[1] === 'AMOUNT' ? moneyLine(content, n) : [x]));
  const gloss = Object.fromEntries(Object.entries(l.gloss).map(([k, v]) => [k, fmt(v, { n: String(n) })]));
  return { vo: l.vo ? fmt(l.vo, { n: String(n) }) : undefined, line, gloss };
}

/** Index de la bonne option de chaque case. */
export const rightPicks = (tk: Ticket): TicketPicks => tk.items.map((it) => it.cells.map((c) => Math.max(0, c.options.findIndex((o) => o.ok))));

/** Ligne d'un ticket : chaque élément est la suite des options cochées, séparés par une virgule. */
export function ticketLine(tk: Ticket, picks: TicketPicks, sep: Token = ['p', '，']): Token[] {
  const out: Token[] = [];
  tk.items.forEach((it, i) => {
    if (i) out.push(sep);
    it.cells.forEach((c, j) => out.push(...(c.options[picks[i]?.[j] ?? 0]?.line ?? [])));
  });
  return out;
}

/** Cases fausses du ticket rempli : [élément, case]. */
export function wrongCells(tk: Ticket, picks: TicketPicks): [number, number][] {
  const bad: [number, number][] = [];
  tk.items.forEach((it, i) => it.cells.forEach((c, j) => !c.options[picks[i]?.[j] ?? -1]?.ok && bad.push([i, j])));
  return bad;
}

export const total = (tk: Ticket) => tk.items.reduce((s, it) => s + it.n * it.unit, 0);

/** L'addition, en mots et en chiffres : « 两块 + 两块 + 三块 = 七块 (2 + 2 + 3 = 7) ». */
export function addition(content: Content, tk: Ticket): string {
  const parts = tk.items.flatMap((it) => Array.from({ length: it.n }, () => it.unit));
  return fmt(content.ui.payCalc ?? '{words} = {sum} ({digits} = {n})', {
    words: parts.map((p) => moneyText(content, p)).join(' + '),
    sum: moneyText(content, total(tk)),
    digits: parts.join(' + '),
    n: String(total(tk)),
  });
}

/** La soustraction de la monnaie : « 十块 − 七块 = 三块 (10 − 7 = 3) ». */
export function subtraction(content: Content, paid: number, due: number): string {
  return fmt(content.ui.payChangeCalc ?? '{paid} − {due} = {change} ({p} − {d} = {c})', {
    paid: moneyText(content, paid),
    due: moneyText(content, due),
    change: moneyText(content, paid - due),
    p: String(paid),
    d: String(due),
    c: String(paid - due),
  });
}

/** La monnaie rendue avec le moins de pièces et billets possible (pour montrer la bonne réponse). */
export function makeChange(amount: number, coins: number[]): number[] {
  const out: number[] = [];
  let left = amount;
  for (const c of [...coins].sort((a, b) => b - a))
    while (left >= c) {
      out.push(c);
      left -= c;
    }
  return out;
}
