export const SESSION_MS = 10 * 60 * 1000;

export const LEVEL_NAMES = {
  facts: ["Лёгкие", "Увереннее", "Вся таблица", "На скорость"],
  column: ["Без переноса", "С переносом", "На трёхзначные", "На двузначное", "Большие"],
  division: ["Простое", "Трёхзначные", "С остатком", "На двузначное"],
};

export const MODE_META = {
  facts: { max: 3, window: 15, times: [8000, 8000, 7000, 5000] },
  column: { max: 4, window: 8, times: [90000, 120000, 150000, 180000, 240000] },
  division: { max: 3, window: 8, times: [90000, 120000, 180000, 240000] },
};

export const MODE_TITLE = {
  facts: "Таблица",
  column: "Столбик",
  division: "Уголок",
};

export function emptyState() {
  return {
    updatedAt: new Date(0).toISOString(),
    levels: { facts: 0, column: 0, division: 0 },
    boxes: {},
    recent: { facts: [], column: [], division: [] },
    stats: {},
    daily: {},
  };
}

export function normalizeState(input) {
  const base = emptyState();
  if (!input || typeof input !== "object") return base;
  return {
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : base.updatedAt,
    levels: {
      facts: clampLevel("facts", input.levels?.facts),
      column: clampLevel("column", input.levels?.column),
      division: clampLevel("division", input.levels?.division),
    },
    boxes: isObj(input.boxes) ? input.boxes : {},
    recent: {
      facts: Array.isArray(input.recent?.facts) ? input.recent.facts : [],
      column: Array.isArray(input.recent?.column) ? input.recent.column : [],
      division: Array.isArray(input.recent?.division) ? input.recent.division : [],
    },
    stats: isObj(input.stats) ? input.stats : {},
    daily: isObj(input.daily) ? input.daily : {},
  };
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function clampLevel(mode, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MODE_META[mode].max, Math.floor(n));
}

function tailWrong(recent, n) {
  if (recent.length < n) return false;
  return recent.slice(-n).every((item) => !item.ok);
}

export function nextLevel(mode, level, recent) {
  const spec = MODE_META[mode];
  if (level > 0 && tailWrong(recent, 4)) {
    return { level: level - 1, recent: [], change: "down" };
  }
  const window = recent.slice(-spec.window);
  if (window.length >= spec.window) {
    const acc = window.filter((item) => item.ok).length / window.length;
    const onTime = window.filter((item) => item.ms <= spec.times[level]).length / window.length;
    if (acc >= 0.9 && onTime >= 0.8 && level < spec.max) {
      return { level: level + 1, recent: [], change: "up" };
    }
    if (acc < 0.6 && level > 0) {
      return { level: level - 1, recent: [], change: "down" };
    }
  }
  return { level, recent, change: null };
}

export function moscowDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(date);
}

function bumpStat(stats, key, ok) {
  const prev = stats[key] || { ok: 0, bad: 0 };
  stats[key] = {
    ok: prev.ok + (ok ? 1 : 0),
    bad: prev.bad + (ok ? 0 : 1),
  };
}

function pruneDaily(daily) {
  const keys = Object.keys(daily).sort();
  while (keys.length > 60) {
    delete daily[keys.shift()];
  }
  return daily;
}

export function applyResult(state, mode, { ok, ms, factKey = null, weakKeys = [] }) {
  const current = normalizeState(state);
  const level = current.levels[mode];
  const recent = current.recent[mode].concat([{ ok, ms: Math.max(0, ms | 0) }]).slice(-20);
  const moved = nextLevel(mode, level, recent);
  const boxes = { ...current.boxes };
  const stats = { ...current.stats };

  if (mode === "facts" && factKey) {
    const fast = ok && ms <= MODE_META.facts.times[level];
    const cur = boxes[factKey] ?? 0;
    boxes[factKey] = !ok ? 0 : fast ? Math.min(4, cur + 1) : cur;
    bumpStat(stats, factKey, ok);
  }

  for (const key of weakKeys) {
    boxes[key] = 0;
    bumpStat(stats, key, false);
  }

  const day = moscowDay();
  const daily = { ...current.daily };
  const dayRow = { ...(daily[day] || {}) };
  const slot = { ok: 0, bad: 0, ms: 0, ...(dayRow[mode] || {}) };
  slot.ok += ok ? 1 : 0;
  slot.bad += ok ? 0 : 1;
  slot.ms += Math.max(0, ms | 0);
  dayRow[mode] = slot;
  daily[day] = dayRow;

  return {
    change: moved.change,
    level: moved.level,
    state: {
      ...current,
      updatedAt: new Date().toISOString(),
      levels: { ...current.levels, [mode]: moved.level },
      recent: { ...current.recent, [mode]: moved.recent },
      boxes,
      stats,
      daily: pruneDaily(daily),
    },
  };
}

export function sessionPlan() {
  return [
    "facts", "facts", "facts", "facts", "facts", "facts",
    "column",
    "facts", "facts", "facts", "facts",
    "column",
    "division",
  ];
}

export function levelNote(mode, change, level) {
  const name = LEVEL_NAMES[mode][level];
  if (change === "up") return `Новый уровень: «${name}».`;
  return `Дальше уровень «${name}»: так примеры будут спокойнее.`;
}
