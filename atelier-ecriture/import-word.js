/* Lecture d'un cours au format Word (.docx), dans le navigateur, sans serveur.
 * Un .docx est un zip ; le texte est dans word/document.xml. On y cherche :
 *  - les tableaux de vocabulaire dont l'en-tête contient « 词 » (ou « mot ») et « Analyse » :
 *    colonnes mot · pinyin · sens · analyse ; l'analyse d'un mot de plusieurs caractères est découpée
 *    caractère par caractère quand elle suit la forme « 机 : … 场 : … » ;
 *  - les phrases en chinois des paragraphes (textes « sans pinyin », dialogues) : elles deviennent des contextes ;
 *  - le titre (premier paragraphe non vide), qui nomme le paquet.
 * Le pinyin posé au-dessus des caractères (balises ruby de Word) est lu à part et n'abîme pas le texte. */
(function (racine) {
  'use strict';
  const HAN = /[㐀-䶿一-鿿]/;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function chargerFflate() {
    if (racine.fflate) return Promise.resolve();
    return new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = 'lib/fflate.min.js'; s.dataset.lib = 'fflate.min.js';
      s.onload = ok; s.onerror = () => ko(new Error('Impossible de charger fflate')); document.head.appendChild(s);
    });
  }

  // texte d'un nœud Word : les w:t, sauf ceux du pinyin (w:rt) ; tabulations et retours deviennent des espaces
  function texte(n) {
    let t = '';
    const parcourir = e => {
      for (const x of e.childNodes) {
        if (x.nodeType !== 1) continue;
        if (x.localName === 'rt') continue;
        if (x.localName === 't') t += x.textContent;
        else if (x.localName === 'tab' || x.localName === 'br') t += ' ';
        else if (x.localName === 'p' && t && !/\s$/.test(t)) { parcourir(x); t += '\n'; continue; }
        else parcourir(x);
      }
    };
    parcourir(n);
    return t.replace(/[ \t]+/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+([.,;:])/g, '$1').trim();
  }

  /* Découpe « 机 : 木 (bois) + 几…. 场 : 土 (terre)… » en { 机: '…', 场: '…' } pour les caractères du mot. */
  function decouper(mot, analyse) {
    const cars = [...mot].filter(c => HAN.test(c));
    if (cars.length <= 1) return cars.length ? { [cars[0]]: analyse } : {};
    const re = new RegExp('(^|[\\s.;»)])(' + cars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*(?:\\([^)]*\\)\\s*)?:\\s', 'g');
    const marques = []; let m;
    while ((m = re.exec(analyse))) marques.push({ c: m[2], debut: m.index + m[1].length, apres: re.lastIndex });
    const res = {};
    marques.forEach((mq, i) => {
      if (res[mq.c]) return;   // première explication du caractère seulement
      const fin = i + 1 < marques.length ? marques[i + 1].debut : analyse.length;
      res[mq.c] = analyse.slice(mq.debut, fin).trim();
    });
    // la phrase qui conclut sur le mot entier (« 机场 = … ») va à chaque caractère comme complément
    return res;
  }

  async function lire(octets, nomFichier) {
    await chargerFflate();
    const zip = fflate.unzipSync(new Uint8Array(octets));
    const xml = zip['word/document.xml'];
    if (!xml) throw new Error('Ce fichier ne ressemble pas à un document Word (.docx).');
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
    const corps = doc.getElementsByTagNameNS(W, 'body')[0];
    const mots = [], phrases = [], vues = new Set();
    let titre = '';
    for (const bloc of corps.childNodes) {
      if (bloc.nodeType !== 1) continue;
      if (bloc.localName === 'p') {
        const t = texte(bloc);
        if (!t) continue;
        if (!titre && !HAN.test(t)) titre = t.slice(0, 80);
        // phrases : paragraphes majoritairement chinois, découpés à la ponctuation finale
        const sans = t.replace(/^[A-Za-zÀ-ÿ]{1,3}\s*[:：]\s*/, '');
        const nHan = [...sans].filter(c => HAN.test(c)).length;
        const nLat = (sans.match(/[A-Za-zÀ-ÿ]/g) || []).length;
        if (nHan >= 4 && nHan > nLat * 2) {
          (sans.match(/[^。！？!?]+[。！？!?]?/g) || []).forEach(p => {
            const zh = p.replace(/^\s*\d+[.)]\s*/, '').replace(/["“”«»「」]/g, '').replace(/^[\s'’:：，,]+/, '').trim();
            if ([...zh].filter(c => HAN.test(c)).length >= 3 && !/[A-Za-zÀ-ÿ]{3,}/.test(zh) && !vues.has(zh) && !/_{2,}|\//.test(zh)) {
              vues.add(zh); phrases.push(zh);
            }
          });
        }
      } else if (bloc.localName === 'tbl') {
        const lignes = [...bloc.getElementsByTagNameNS(W, 'tr')].map(tr => [...tr.getElementsByTagNameNS(W, 'tc')].map(texte));
        if (!lignes.length) continue;
        const tete = lignes[0].map(x => x.toLowerCase());
        const iMot = tete.findIndex(x => x.includes('词') || x.startsWith('mot') || x.includes('caract'));
        const iAna = tete.findIndex(x => x.includes('analyse') || x.includes('étymo') || x.includes('explication'));
        if (iMot < 0 || iAna < 0) continue;
        const iPy = tete.findIndex(x => x.includes('pinyin')), iSens = tete.findIndex(x => x.includes('sens') || x.includes('traduction'));
        lignes.slice(1).forEach(l => {
          const mot = (l[iMot] || '').replace(/\s+/g, '');
          if (!HAN.test(mot)) return;
          const analyse = (l[iAna] || '').replace(/\s*\n\s*/g, ' ');
          mots.push({ zh: mot, py: iPy >= 0 ? (l[iPy] || '').trim() : '', fr: iSens >= 0 ? (l[iSens] || '').replace(/\s+/g, ' ').trim() : '', analyse, parCar: decouper(mot, analyse) });
        });
      }
    }
    const nom = titre || String(nomFichier || 'Cours').replace(/\.docx$/i, '').replace(/^[0-9a-f]{8}-/i, '').replace(/_/g, ' ');
    return { nom, mots, phrases };
  }

  racine.ImportWord = { lire, decouper, texte };
})(typeof window !== 'undefined' ? window : globalThis);
