// Prépare data.json : tracés des caractères (makemeahanzi / hanzi-writer-data, licence Arphic) pour la signature
// de Lín Yuè et les huit villes de la carte.
import { readFileSync, writeFileSync } from 'node:fs';
const DATA = new URL('../../node_modules/hanzi-writer-data/', import.meta.url).pathname;
const chars = {};
for (const c of new Set('林月上海杭州南京开封北京西安洛阳安阳')) chars[c] = JSON.parse(readFileSync(DATA + c + '.json', 'utf8'));
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify({ chars }));
console.log('chars', Object.keys(chars).join(''));
