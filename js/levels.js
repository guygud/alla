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

export const MODES = ["facts", "column", "division"];

export const MODE_TITLE = {
  facts: "Таблица",
  column: "Столбик",
  division: "Уголок",
};

export const STAR_MAX = 3;
export const REVIEW_GAP_DAYS = 3;

export function emptyState() {
  return {
    updatedAt: new Date(0).toISOString(),
    levels: { facts: 0, column: 0, division: 0 },
    boxes: {},
    recent: { facts: [], column: [], division: [] },
    stars: emptyStars(),
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
    stars: normalizeStars(input.stars),
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

function emptyStars() {
  const stars = {};
  for (const mode of MODES) {
    stars[mode] = Array.from({ length: MODE_META[mode].max + 1 }, () => null);
  }
  return stars;
}

function normalizeStars(input) {
  const stars = emptyStars();
  if (!isObj(input)) return stars;
  for (const mode of MODES) {
    const row = Array.isArray(input[mode]) ? input[mode] : [];
    for (let level = 0; level <= MODE_META[mode].max; level += 1) {
      const item = row[level];
      if (!isObj(item)) continue;
      const n = Math.min(STAR_MAX, Math.max(0, Math.floor(Number(item.n) || 0)));
      const last = typeof item.last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.last) ? item.last : "";
      if (n > 0 && last) stars[mode][level] = { n, last };
    }
  }
  return stars;
}

function cloneStars(stars) {
  const copy = {};
  for (const mode of MODES) {
    copy[mode] = stars[mode].map((item) => (item ? { n: item.n, last: item.last } : null));
  }
  return copy;
}

function putStar(stars, mode, level, n, day) {
  const copy = cloneStars(stars);
  copy[mode][level] = { n, last: day };
  return copy;
}

export function starTotal(state, mode = null) {
  const stars = normalizeState(state).stars;
  const modes = mode ? [mode] : MODES;
  let total = 0;
  for (const name of modes) {
    for (const item of stars[name]) total += item?.n || 0;
  }
  return total;
}

export function starCap(mode = null) {
  const modes = mode ? [mode] : MODES;
  return modes.reduce((sum, name) => sum + (MODE_META[name].max + 1) * STAR_MAX, 0);
}

function dayNumber(day) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
}

export function daysBetween(from, to) {
  if (!from || !to) return 0;
  return dayNumber(to) - dayNumber(from);
}

export function grantFirstStar(state, mode, level, day) {
  const current = normalizeState(state);
  const have = current.stars[mode][level];
  if (have && have.n >= 1) return { state: current, gained: false };
  return {
    gained: true,
    state: { ...current, stars: putStar(current.stars, mode, level, 1, day) },
  };
}

export function grantNextStar(state, mode, level, day) {
  const current = normalizeState(state);
  const have = current.stars[mode][level];
  if (!have || have.n < 1 || have.n >= STAR_MAX) return { state: current, gained: false };
  return {
    gained: true,
    state: { ...current, stars: putStar(current.stars, mode, level, have.n + 1, day) },
  };
}

export function touchStarDate(state, mode, level, day) {
  const current = normalizeState(state);
  const have = current.stars[mode][level];
  if (!have) return current;
  return { ...current, stars: putStar(current.stars, mode, level, have.n, day) };
}

export function reviewLength(mode) {
  return mode === "facts" ? 5 : 2;
}

export function reviewTarget(state, day) {
  const current = normalizeState(state);
  let best = null;
  for (const mode of MODES) {
    for (let level = 0; level <= MODE_META[mode].max; level += 1) {
      const star = current.stars[mode][level];
      if (!star || star.n < 1 || star.n >= STAR_MAX) continue;
      if (daysBetween(star.last, day) < REVIEW_GAP_DAYS) continue;
      if (!best || star.last < best.last) best = { mode, level, last: star.last };
    }
  }
  return best ? { mode: best.mode, level: best.level } : null;
}

export function starMarks(state, mode, level, day = moscowDay()) {
  const star = normalizeState(state).stars[mode][level];
  const n = star?.n || 0;
  return Array.from({ length: STAR_MAX }, (_, index) => ({
    on: index < n,
    fresh: index === n - 1 && star?.last === day,
  }));
}

const NB = "\u00A0";

function tailWrong(recent, n) {
  if (recent.length < n) return false;
  return recent.slice(-n).every((item) => !item.ok);
}

function windowHolds(mode, level, recent) {
  const spec = MODE_META[mode];
  const window = recent.slice(-spec.window);
  if (window.length < spec.window) return false;
  const acc = window.filter((item) => item.ok).length / window.length;
  const onTime = window.filter((item) => item.ms <= spec.times[level]).length / window.length;
  return acc >= 0.9 && onTime >= 0.8;
}

export function modeMastered(mode, level, recent = []) {
  if (level < MODE_META[mode].max) return false;
  return windowHolds(mode, level, recent);
}

function masteredModes(state) {
  const current = normalizeState(state);
  return ["facts", "column", "division"].filter((mode) =>
    modeMastered(mode, current.levels[mode], current.recent[mode]),
  );
}

export function nextLevel(mode, level, recent) {
  const spec = MODE_META[mode];
  if (level > 0 && tailWrong(recent, 4)) {
    return { level: level - 1, recent: [], change: "down" };
  }
  const window = recent.slice(-spec.window);
  if (window.length >= spec.window) {
    if (windowHolds(mode, level, recent) && level < spec.max) {
      return { level: level + 1, recent: [], change: "up" };
    }
    const acc = window.filter((item) => item.ok).length / window.length;
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
  const daily = bumpDaily(current.daily, mode, { ok, ms }, day);
  let stars = current.stars;
  let star = null;
  if (moved.change === "up") {
    const awarded = grantFirstStar({ ...current, stars }, mode, level, day);
    stars = awarded.state.stars;
    if (awarded.gained) star = { mode, level, n: 1 };
  } else if (
    moved.change !== "down"
    && level === MODE_META[mode].max
    && windowHolds(mode, level, moved.recent)
  ) {
    const awarded = grantFirstStar({ ...current, stars }, mode, level, day);
    stars = awarded.state.stars;
    if (awarded.gained) star = { mode, level, n: 1 };
  }

  return {
    change: moved.change,
    level: moved.level,
    star,
    state: {
      ...current,
      updatedAt: new Date().toISOString(),
      levels: { ...current.levels, [mode]: moved.level },
      recent: { ...current.recent, [mode]: moved.recent },
      stars,
      boxes,
      stats,
      daily: pruneDaily(daily),
    },
  };
}

function bumpDaily(daily, mode, { ok, ms }, day) {
  const next = { ...daily };
  const dayRow = { ...(next[day] || {}) };
  const slot = { ok: 0, bad: 0, ms: 0, ...(dayRow[mode] || {}) };
  slot.ok += ok ? 1 : 0;
  slot.bad += ok ? 0 : 1;
  slot.ms += Math.max(0, ms | 0);
  dayRow[mode] = slot;
  next[day] = dayRow;
  return next;
}

export function recordPractice(state, mode, { ok, ms }) {
  const current = normalizeState(state);
  const day = moscowDay();
  return {
    ...current,
    updatedAt: new Date().toISOString(),
    daily: pruneDaily(bumpDaily(current.daily, mode, { ok, ms }, day)),
  };
}

export function windowProgress(mode, level, recent) {
  const spec = MODE_META[mode];
  const window = (recent || []).slice(-spec.window);
  const errors = window.filter((item) => !item.ok).length;
  return {
    have: window.length,
    need: spec.window,
    errors,
    allowedErrors: spec.window - Math.ceil(spec.window * 0.9),
  };
}

export function progressLine(mode, state) {
  const current = normalizeState(state);
  const progress = windowProgress(mode, current.levels[mode], current.recent[mode]);
  const name = LEVEL_NAMES[mode][current.levels[mode]];
  return `До проверки уровня «${name}»: ${progress.have} из ${progress.need} примеров, ошибок пока ${progress.errors}.`;
}

export function contributionLines(before, after) {
  const prev = normalizeState(before);
  const next = normalizeState(after);
  const lines = [];
  for (const mode of MODES) {
    if (next.levels[mode] > prev.levels[mode]) {
      lines.push(`Новый уровень: «${LEVEL_NAMES[mode][next.levels[mode]]}».`);
    } else if (next.levels[mode] < prev.levels[mode]) {
      lines.push(levelNote(mode, "down", next.levels[mode]));
    }
    for (let level = 0; level <= MODE_META[mode].max; level += 1) {
      const was = prev.stars[mode][level]?.n || 0;
      const now = next.stars[mode][level]?.n || 0;
      if (now > was) lines.push(`Новая звезда на уровне «${LEVEL_NAMES[mode][level]}».`);
    }
  }
  if (lines.length) return lines;
  const bits = [];
  for (const mode of MODES) {
    if (JSON.stringify(next.recent[mode]) === JSON.stringify(prev.recent[mode])) continue;
    const progress = windowProgress(mode, next.levels[mode], next.recent[mode]);
    bits.push(`${MODE_TITLE[mode].toLowerCase()} ${progress.have} из ${progress.need}`);
  }
  if (bits.length) lines.push(`Сегодня шаги к следующей проверке: ${bits.join(", ")}.`);
  return lines;
}

export function dayTotals(state, day = moscowDay()) {
  const row = normalizeState(state).daily[day] || {};
  let ok = 0;
  let bad = 0;
  for (const mode of MODES) {
    ok += Number(row[mode]?.ok) || 0;
    bad += Number(row[mode]?.bad) || 0;
  }
  return { ok, bad, total: ok + bad };
}

function mondayOf(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - delta);
  return date;
}

export function weekMarks(state, day = moscowDay()) {
  const current = normalizeState(state);
  const start = mondayOf(day);
  const labels = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  return labels.map((label, index) => {
    const date = new Date(start.getTime());
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      label,
      key,
      active: dayTotals(current, key).total > 0,
      today: key === day,
    };
  });
}

const CLASSIC_PLAN = [
  "facts", "facts", "facts", "facts", "facts", "facts",
  "column",
  "facts", "facts", "facts", "facts",
  "column",
  "division",
];

function fill(mode, count) {
  return Array.from({ length: count }, () => mode);
}

function mixFactsAnd(longMode) {
  return [...fill("facts", 4), longMode, ...fill("facts", 4), longMode, ...fill("facts", 2), longMode];
}

function mixColumnAndDivision(levels) {
  const columnProgress = levels.column / MODE_META.column.max;
  const divisionProgress = levels.division / MODE_META.division.max;
  if (Math.abs(columnProgress - divisionProgress) < 1e-9) {
    return ["division", "column", "division", "column", "division", "column", "division", "column"];
  }
  const weak = columnProgress < divisionProgress ? "column" : "division";
  const strong = weak === "column" ? "division" : "column";
  return [weak, strong, weak, weak, strong, weak, strong, weak];
}

export function sessionPlan(state) {
  const current = normalizeState(state);
  const done = new Set(masteredModes(current));
  const open = ["facts", "column", "division"].filter((mode) => !done.has(mode));
  if (open.length === 3) return CLASSIC_PLAN.slice();
  if (open.length === 1) return fill(open[0], open[0] === "facts" ? 15 : 6);
  if (!open.includes("facts")) return mixColumnAndDivision(current.levels);
  return mixFactsAnd(open.find((mode) => mode !== "facts"));
}

const DONE_TEXT = {
  facts: "Таблица освоена.",
  column: "Столбик освоен.",
  division: "Уголок освоен.",
  "facts+column": `Таблица и${NB}столбик освоены.`,
  "facts+division": `Таблица и${NB}уголок освоены.`,
  "column+division": `Столбик и${NB}уголок освоены.`,
};

const TODAY_TEXT = {
  facts: "таблица",
  column: "столбик",
  division: "уголок",
  "facts+column": `таблица и${NB}столбик`,
  "facts+division": `таблица и${NB}уголок`,
  "column+division": `столбик и${NB}уголок`,
};

export function sessionBlurb(state) {
  const done = masteredModes(state);
  if (done.length === 0) return `10 минут: таблица, столбик и${NB}уголок.`;
  if (done.length === 3) return `Всё освоено. Сегодня повторяем столбик и${NB}уголок.`;
  const open = ["facts", "column", "division"].filter((mode) => !done.includes(mode));
  return `${DONE_TEXT[done.join("+")]} Сегодня ${TODAY_TEXT[open.join("+")]}.`;
}

export function levelNote(mode, change, level) {
  const name = LEVEL_NAMES[mode][level];
  if (change === "up") return `Новый уровень: «${name}».`;
  return `Дальше уровень «${name}»: так примеры будут спокойнее.`;
}
