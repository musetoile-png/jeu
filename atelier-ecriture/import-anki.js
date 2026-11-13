/* Lecture des paquets Anki (.apkg) dans le navigateur, sans serveur.
 * Un .apkg est une archive zip : une base SQLite (collection.anki2, .anki21, ou .anki21b compressée en zstd
 * depuis Anki 2.1.50), une liste des sons (JSON, ou protobuf compressé en zstd) et les sons eux-mêmes (0, 1, 2…).
 * Bibliothèques chargées seulement au moment d'importer : fflate (zip), fzstd (zstd), sql.js (SQLite) — toutes MIT.
 * Les fiches d'un paquet sont libres (champs HTML) : on y repère le chinois, le pinyin (balises <ruby> ou texte
 * accentué), le français et les sons [sound:…]. */
(function (racine) {
  'use strict';
  const LIB = 'lib/';
  const HAN = /[㐀-䶿一-鿿]/;
  const SYLLABES = new Set('a ai an ang ao ba bai ban bang bao bei ben beng bi bian biang biao bie bin bing bo bong bu ca cai can cang cao ce cei cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die din ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei len leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nia nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wong wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo'.split(' '));
  const SONS = /\.(mp3|ogg|oga|wav|m4a|aac|opus|webm)$/i;

  function script(src) {
    return new Promise((ok, ko) => {
      if (document.querySelector('script[data-lib="' + src + '"]')) return ok();
      const s = document.createElement('script'); s.src = LIB + src; s.dataset.lib = src;
      s.onload = ok; s.onerror = () => ko(new Error('Impossible de charger ' + src)); document.head.appendChild(s);
    });
  }
  async function bibliotheques() {
    await Promise.all([script('fflate.min.js'), script('fzstd.min.js'), script('sql-wasm.js')]);
    if (!racine.__SQL) racine.__SQL = await initSqlJs({ locateFile: f => LIB + f });
    return racine.__SQL;
  }
  const estZstd = b => b && b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
  const dezstd = b => estZstd(b) ? fzstd.decompress(b) : b;

  // protobuf minimal : MediaEntries { repeated MediaEntry entries = 1 } ; MediaEntry { string name = 1; … }
  function varint(b, i) { let v = 0, m = 1, x; do { x = b[i++]; v += (x & 0x7f) * m; m *= 128; } while (x & 0x80); return [v, i]; }
  function lireMediasProto(b) {
    const noms = []; let i = 0;
    while (i < b.length) {
      let cle; [cle, i] = varint(b, i);
      const champ = cle >> 3, type = cle & 7;
      if (type === 2) {
        let n; [n, i] = varint(b, i);
        const sous = b.subarray(i, i + n); i += n;
        if (champ === 1) {
          let j = 0, nom = '', legacy = null;
          while (j < sous.length) {
            let k; [k, j] = varint(sous, j);
            const f = k >> 3, t = k & 7;
            if (t === 2) { let m; [m, j] = varint(sous, j); if (f === 1) nom = new TextDecoder().decode(sous.subarray(j, j + m)); j += m; }
            else if (t === 0) { let v; [v, j] = varint(sous, j); if (f === 255) legacy = v; }
            else break;
          }
          noms.push({ nom, fichier: legacy !== null ? String(legacy) : String(noms.length) });
        }
      } else if (type === 0) { [, i] = varint(b, i); } else break;
    }
    return noms;
  }

  /* Ouvre un .apkg : renvoie { nom, version, notes:[{id, champs:[html]}], sons: Map(nom -> Uint8Array) } */
  async function lire(octets, nomFichier) {
    const SQL = await bibliotheques();
    const zip = fflate.unzipSync(new Uint8Array(octets));
    let version = 1;
    if (zip.meta && zip.meta.length >= 2 && zip.meta[0] === 0x08) version = zip.meta[1];
    const base = zip['collection.anki21b'] ? dezstd(zip['collection.anki21b']) : zip['collection.anki21'] || zip['collection.anki2'];
    if (!base) throw new Error('Pas de collection Anki dans ce fichier.');
    const db = new SQL.Database(base);
    const notes = [];
    const r = db.exec('SELECT id, flds FROM notes ORDER BY id');
    (r[0] ? r[0].values : []).forEach(([id, flds]) => notes.push({ id: String(id), champs: String(flds).split('\x1f') }));
    let nomPaquet = '';
    try { const d = db.exec('SELECT name FROM decks'); nomPaquet = (d[0] ? d[0].values.map(v => v[0]) : []).filter(n => !/^(default|par défaut)$/i.test(n)).join(' · '); } catch (e) { /* anciennes versions */ }
    if (!nomPaquet) { try { const c = db.exec('SELECT decks FROM col'); const o = JSON.parse(c[0].values[0][0]); nomPaquet = Object.values(o).map(x => x.name).filter(n => !/^(default|par défaut)$/i.test(n)).join(' · '); } catch (e) { /* rien */ } }
    db.close();
    if (!nomPaquet) nomPaquet = String(nomFichier || 'Paquet Anki').replace(/\.apkg$/i, '').replace(/^[0-9a-f]{8}-/i, '').replace(/_/g, ' ').trim();
    // sons
    const sons = new Map();
    if (zip.media) {
      let liste = [];
      if (estZstd(zip.media)) liste = lireMediasProto(fzstd.decompress(zip.media));
      else { try { liste = Object.entries(JSON.parse(new TextDecoder().decode(zip.media))).map(([f, nom]) => ({ nom, fichier: f })); } catch (e) { liste = []; } }
      liste.forEach(({ nom, fichier }) => { if (SONS.test(nom) && zip[fichier]) sons.set(nom, dezstd(zip[fichier])); });
    }
    if (notes.length === 1 && /update|mettre à jour|mise à jour/i.test(notes[0].champs.join(' ')) && version < 3)
      throw new Error('Ce paquet demande une version plus récente : réexporte-le depuis Anki.');
    return { nom: nomPaquet, version, notes, sons };
  }

  // ---------- pinyin ----------
  const PROPRES = /[āǎēěīǐíìōǒóòūǔúǖǘǚǜáĀǍĒĚĪǏÍÌŌǑÓÒŪǓÚǕǗǙǛÁ]/;   // marques que le français n'utilise pas
  const PARTAGEES = /[éèàùÉÈÀÙ]/;
  const PROPRES_OU_PARTAGEES = /[āǎēěīǐíìōǒóòūǔúǖǘǚǜáéèàùĀǍĒĚĪǏÍÌŌǑÓÒŪǓÚǕǗǙǛÁÉÈÀÙ]/;
  const NEUTRES = new Set(['de', 'le', 'ma', 'me', 'men', 'ne', 'ba', 'zi', 'li', 'ge', 'zhe', 'guo', 'a', 'ya', 'la', 'wa', 'na', 'r', 'shi', 'tou', 'mian', 'bian', 'qi', 'ren', 'you', 'si', 'xi', 'fu', 'jie', 'ye', 'ke']);
  const MOTS_FR = new Set(['à', 'où', 'là', 'déjà', 'voilà', 'café', 'été', 'thé']);
  function sansTon(s) {
    return [...s.normalize('NFC')].map(ch => {
      const d = ch.normalize('NFD');
      if (d.includes('̈')) return 'v';
      return d[0];
    }).join('');
  }
  /* Découpe un mot (« xǐshǒujiān », « nǎ'er », « nǎr ») en syllabes ; null si ce n'est pas du pinyin. */
  function syllabes(mot) {
    const morceaux = mot.split(/['’]/).filter(Boolean), res = [];
    for (const m of morceaux) {
      const orig = [...m.normalize('NFC')], nu = sansTon(m).toLowerCase();
      if (/[^a-zv]/.test(nu) || nu.length !== orig.length) return null;
      const n = nu.length, meilleur = new Array(n + 1).fill(null); meilleur[0] = [];
      for (let i = 0; i < n; i++) {
        if (!meilleur[i]) continue;
        for (let l = 1; l <= 6 && i + l <= n; l++) {
          const s = nu.slice(i, i + l);
          if (SYLLABES.has(s) || (s === 'r' && i > 0 && i + l === n && PROPRES_OU_PARTAGEES.test(m))) {
            const cand = meilleur[i].concat([orig.slice(i, i + l).join('')]);
            if (!meilleur[i + l] || cand.length < meilleur[i + l].length) meilleur[i + l] = cand;
          }
        }
      }
      if (!meilleur[n]) return null;
      res.push(...meilleur[n]);
    }
    // « nǎr » : le r d'erhua se rattache au caractère 儿
    return res.length ? res : null;
  }
  /* Repère les suites de mots en pinyin dans un texte latin. Renvoie [{debut, fin, syllabes}] */
  function suitesPinyin(texte) {
    const mots = [...texte.matchAll(/[A-Za-zÀ-ÿĀ-ſǍ-ǜ'’]+/g)];
    const suites = []; let cur = null;
    const fermer = () => { if (cur) suites.push(cur); cur = null; };
    for (const m of mots) {
      const s = syllabes(m[0]);
      const entre = cur ? texte.slice(cur.fin, m.index) : '';
      const lie = cur && /^[ \t,\-–…/()]*$/.test(entre);
      const accent = PROPRES_OU_PARTAGEES.test(m[0]);
      if (!s || MOTS_FR.has(m[0].toLowerCase())) { fermer(); continue; }
      if (accent) {
        const ancre = PROPRES.test(m[0]) || s.length > 1;
        if (lie) { cur.fin = m.index + m[0].length; cur.syl.push(...s); cur.ancre = cur.ancre || ancre; cur.n++; }
        else { fermer(); cur = { debut: m.index, fin: m.index + m[0].length, syl: [...s], ancre, n: 1 }; }
      } else if (lie && s.every(x => NEUTRES.has(x.toLowerCase()))) {
        cur.fin = m.index + m[0].length; cur.syl.push(...s); cur.n++;
      } else fermer();
    }
    fermer();
    return suites.filter(x => x.ancre || x.n >= 2);
  }

  /* Une fiche -> { zh, py, fr, sons, cars:[{c, py}] } */
  function texteDe(html, sons) {
    html = html.replace(/\[sound:([^\]]+)\]/g, (_, s) => { sons.push(s.trim()); return ' '; });
    html = html.replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/g, '$1');
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    let texte = '';
    const rubis = [];
    (function parcourir(n) {
      for (const e of n.childNodes) {
        if (e.nodeType === 3) texte += e.nodeValue;
        else if (e.nodeType === 1) {
          const t = e.tagName;
          if (t === 'RUBY') {
            let base = '', rt = '';
            e.childNodes.forEach(x => { if (x.nodeType === 3) base += x.nodeValue; else if (x.tagName === 'RT') rt += x.textContent + ' '; else if (x.tagName !== 'RP') base += x.textContent; });
            rubis.push({ debut: texte.length, base, rt: rt.replace(/\s+/g, ' ').trim() });
            texte += base;
          } else if (t === 'BR') texte += '\n';
          else if (t === 'DIV' || t === 'P' || t === 'LI') { texte += '\n'; parcourir(e); texte += '\n'; }
          else if (t !== 'SCRIPT' && t !== 'STYLE') parcourir(e);
        }
      }
    })(doc.body.firstChild);
    return { texte: texte.replace(/ /g, ' '), rubis };
  }
  const RE_SEG = /[㐀-䶿一-鿿](?:[㐀-䶿一-鿿　-〿！-？…·]|\.{2,3}|[?!](?=\s|$))*/g;
  function nettoyerFr(fr) {
    fr = fr.replace(/\(\s*\)/g, ' ').replace(/(^|\s)[=\-–](?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    const m = fr.match(/^\(([^()]*)\)$/); if (m) fr = m[1];
    fr = fr.replace(/^[\s\-–=:,;/]+|[\s\-–=:,;/]+$/g, '');
    if ((fr.match(/\(/g) || []).length < (fr.match(/\)/g) || []).length) fr = fr.replace(/\)\s*$/, '').replace(/^\s*\)/, '');
    if ((fr.match(/\(/g) || []).length > (fr.match(/\)/g) || []).length) fr = fr.replace(/^\(\s*/, '').replace(/\s*\($/, '');
    return fr.trim();
  }

  /* Une fiche -> { zh, py, fr, note, sons, cars:[{c, py}] } : on lit le recto et le verso (premier paragraphe),
     le reste (paragraphes suivants, champs « extra ») devient une note de la prof. */
  function analyserNote(note) {
    const sons = [];
    const principaux = note.champs.slice(0, 2).map(h => texteDe(h, sons));
    const extras = note.champs.slice(2).map(h => texteDe(h, sons).texte);
    let texte = '', rubis = [];
    principaux.forEach(({ texte: t, rubis: r }) => {
      const coupe = t.search(/\n[ \t]*\n/);
      const garde = coupe > 0 && /\S/.test(t.slice(0, coupe)) ? t.slice(0, coupe) : t;
      if (garde !== t) extras.push(t.slice(coupe));
      r.filter(x => x.debut < garde.length).forEach(x => rubis.push({ ...x, debut: x.debut + texte.length }));
      texte += garde + '\n';
    });
    const segs = [...texte.matchAll(RE_SEG)].map(m => ({ debut: m.index, fin: m.index + m[0].length, t: m[0] }));
    const syl = [];
    rubis.forEach(r => (r.rt.split(' ').flatMap(x => syllabes(x.replace(/[^\p{L}'’]/gu, '')) || [])).forEach((s, i) => syl.push({ pos: r.debut + i * 0.001, s })));
    let sansHan = texte;
    segs.forEach(g => { sansHan = sansHan.slice(0, g.debut) + ' '.repeat(g.fin - g.debut) + sansHan.slice(g.fin); });
    const suites = suitesPinyin(sansHan);
    suites.forEach(x => x.syl.forEach((s, i) => syl.push({ pos: x.debut + i * 0.001, s })));
    syl.sort((a, b) => a.pos - b.pos);
    let fr = sansHan;
    suites.slice().reverse().forEach(x => { fr = fr.slice(0, x.debut) + ' '.repeat(x.fin - x.debut) + fr.slice(x.fin); });
    fr = nettoyerFr(fr);
    // le chinois principal = premier segment ; les autres (synonymes 这里 = 这儿…) vont dans la note
    const principal = segs.length ? segs[0].t.replace(/\.{2,3}$/, '…') : '';
    const autres = segs.slice(1).map(g => g.t);
    const hans = [...principal].filter(c => HAN.test(c));
    let cars = hans.map(c => ({ c, py: '' }));
    const ss = syl.map(x => x.s.toLowerCase());
    if (ss.length >= hans.length && hans.length) cars = hans.map((c, i) => ({ c, py: ss[i] }));
    else if (ss.length === hans.length - hans.filter(c => c === '儿').length) {
      let j = 0; cars = hans.map(c => ({ c, py: c === '儿' ? 'r' : (ss[j++] || '') }));
    }
    const py = syl.slice(0, Math.max(hans.length, 1) + (ss.length > hans.length && autres.length === 0 ? ss.length : 0)).map(x => x.s).join(' ').replace(/ r(?=\s|$)/g, 'r');
    const noteTexte = autres.concat(extras.map(t => t.replace(/\s+/g, ' ').trim())).filter(t => t && !/^(y|oui|yes)$/i.test(t)).join(' · ');
    return { id: note.id, zh: principal, py, fr, note: noteTexte, sons, cars, nbHan: hans.length };
  }

  racine.ImportAnki = { lire, analyserNote, syllabes, suitesPinyin };
})(typeof window !== 'undefined' ? window : globalThis);
