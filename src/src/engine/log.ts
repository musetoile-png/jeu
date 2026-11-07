/**
 * Journal d'événements : la matière première de la recherche.
 * Chaque événement est horodaté et exportable en CSV depuis le menu.
 */
export interface LogEvent {
  t: number;
  scene: string;
  step: number;
  kind:
    | 'listen'
    | 'answer'
    | 'retry'
    | 'scene_start'
    | 'scene_end'
    | 'word_met'
    | 'fail'
    | 'item_get'
    | 'item_lose'
    | 'choice_set'
    | 'detour_start'
    | 'detour_end'
    | 'photo_taken'
    | 'quest_choice'
    | 'errand_ready';
  detail?: string; // ex. rate=0.75 | choice=2 | errorType=semantic
  word?: string;
  ok?: boolean;
  /** « connu » si le mot a déjà été rencontré dans un autre contexte, « nouveau » sinon (§12) */
  context?: 'connu' | 'nouveau';
}

const KEY = 'jeu-zh-log';
const events: LogEvent[] = load();

function load(): LogEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LogEvent[];
  } catch {
    return [];
  }
}

export function log(e: Omit<LogEvent, 't'>) {
  events.push({ t: Date.now(), ...e });
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-5000)));
  } catch {
    /* stockage indisponible */
  }
}

export function toCsv(): string {
  const cols: (keyof LogEvent)[] = ['t', 'scene', 'step', 'kind', 'word', 'ok', 'context', 'detail'];
  const esc = (v: unknown) => (v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);
  return [cols.join(','), ...events.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
}

export function count() {
  return events.length;
}
