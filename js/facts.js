export const FACT_POOLS = [
  { multipliers: [2, 5, 10], fresh: [2, 5, 10] },
  { multipliers: [2, 3, 4, 5, 10], fresh: [3, 4] },
  { multipliers: [2, 3, 4, 5, 6, 7, 8, 9, 10], fresh: [6, 7, 8, 9] },
  { multipliers: [2, 3, 4, 5, 6, 7, 8, 9, 10], fresh: [6, 7, 8, 9] },
];

const WEIGHT = [8, 4, 2, 1, 0.5];

export function factKey(a, b) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}*${y}`;
}

export function nextBox(box, { ok, fast }) {
  const cur = box ?? 0;
  if (!ok) return 0;
  if (!fast) return cur;
  return Math.min(4, cur + 1);
}

export function factCandidates(level, boxes = {}) {
  const spec = FACT_POOLS[Math.max(0, Math.min(FACT_POOLS.length - 1, level))];
  const list = [];
  for (const m of spec.multipliers) {
    for (let n = 2; n <= 9; n += 1) {
      const key = factKey(m, n);
      let w = WEIGHT[boxes[key] ?? 0];
      if (spec.fresh.includes(m)) w *= 2;
      list.push({ a: m, b: n, w, key });
    }
  }
  return list;
}

function weightedIndex(weights, rand) {
  const total = weights.reduce((s, w) => s + w, 0);
  let ticket = rand() * total;
  for (let i = 0; i < weights.length; i += 1) {
    ticket -= weights[i];
    if (ticket < 0) return i;
  }
  return weights.length - 1;
}

export function pickFact(boxes, level, rand = Math.random) {
  const list = factCandidates(level, boxes);
  const idx = weightedIndex(list.map((item) => item.w), rand);
  let { a, b, key } = list[idx];
  if (rand() < 0.5) [a, b] = [b, a];
  const product = a * b;
  if (rand() < 0.4) {
    const divisor = rand() < 0.5 ? a : b;
    return {
      op: "div",
      left: product,
      right: divisor,
      answer: product / divisor,
      key,
      a,
      b,
    };
  }
  return { op: "mul", left: a, right: b, answer: product, key, a, b };
}

export function factPrompt(problem) {
  const sign = problem.op === "div" ? ":" : "×";
  return `${problem.left} ${sign} ${problem.right}`;
}

export function factHint(problem) {
  if (problem.op === "div") {
    return `${problem.left} : ${problem.right} = ${problem.answer}.`;
  }
  return `${problem.left} × ${problem.right} = ${problem.answer}.`;
}

export function factMaxLen(problem) {
  return String(problem.answer).length;
}
