const NB = "\u00A0";

function randInt(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function hasMidCarry(a, digit) {
  const ds = String(a).split("").map(Number).reverse();
  let carry = 0;
  for (let i = 0; i < ds.length; i += 1) {
    const newCarry = Math.floor((ds[i] * digit + carry) / 10);
    if (newCarry > 0 && i < ds.length - 1) return true;
    carry = newCarry;
  }
  return false;
}

function generateNoCarry(rand) {
  const b = randInt(rand, 2, 4);
  const maxD = Math.max(1, Math.floor(9 / b));
  const d1 = randInt(rand, 1, maxD);
  const d0 = randInt(rand, 1, maxD);
  return { a: d1 * 10 + d0, b, level: 0 };
}

function generateWithCarry(digits, level, rand) {
  for (let i = 0; i < 80; i += 1) {
    const b = randInt(rand, 2, 9);
    let a = randInt(rand, 1, 9);
    for (let k = 1; k < digits; k += 1) a = a * 10 + randInt(rand, 0, 9);
    if (hasMidCarry(a, b)) return { a, b, level };
  }
  return digits === 2 ? { a: 25, b: 4, level } : { a: 125, b: 6, level };
}

export function generateColumn(level, rand = Math.random) {
  const lv = Math.max(0, Math.min(4, level | 0));
  if (lv === 0) return generateNoCarry(rand);
  if (lv === 1) return generateWithCarry(2, 1, rand);
  if (lv === 2) return generateWithCarry(3, 2, rand);
  if (lv === 3) return { a: randInt(rand, 12, 98), b: randInt(rand, 12, 98), level: 3 };
  return { a: randInt(rand, 102, 899), b: randInt(rand, 12, 89), level: 4 };
}

function hintMul(d, digit, carry, sum, write, newCarry) {
  const base = d * digit;
  let text = `${d} × ${digit} = ${base}`;
  if (carry) text += `, плюс ${carry} в${NB}уме${NB}— это ${sum}`;
  text += `. Записываем ${write}`;
  if (newCarry) text += `, запоминаем ${newCarry}`;
  return `${text}.`;
}

function hintSum(terms, carry, sum, write, newCarry) {
  const parts = carry ? [...terms, carry] : terms;
  let text = `${parts.join(" + ")} = ${sum}. Записываем ${write}`;
  if (newCarry) text += `, запоминаем ${newCarry}`;
  return `${text}.`;
}

function partialSteps(a, digit, shift, partial) {
  const ds = String(a).split("").map(Number).reverse();
  const steps = [];
  let carry = 0;
  for (let i = 0; i < ds.length; i += 1) {
    const d = ds[i];
    const sum = d * digit + carry;
    const write = sum % 10;
    const newCarry = Math.floor(sum / 10);
    const incoming = carry;
    const hint = hintMul(d, digit, incoming, sum, write, newCarry);
    const table = d >= 2 && d <= 9 && digit >= 2 && digit <= 9;
    steps.push({
      kind: "partial-write",
      partial,
      fromRight: i + shift,
      expect: String(write),
      prompt: incoming
        ? `${d} × ${digit} плюс ${incoming} в${NB}уме. Какую цифру записываем?`
        : `${d} × ${digit}. Какую цифру записываем?`,
      hint,
      fact: table ? { a: d, b: digit } : null,
    });
    if (newCarry > 0 && i < ds.length - 1) {
      steps.push({
        kind: "partial-carry",
        partial,
        fromRight: i + shift + 1,
        expect: String(newCarry),
        prompt: "Сколько запоминаем?",
        hint,
        fact: null,
      });
    }
    carry = newCarry;
  }
  if (carry > 0) {
    steps.push({
      kind: "partial-write",
      partial,
      fromRight: ds.length + shift,
      expect: String(carry),
      prompt: "Какую цифру записываем впереди?",
      hint: `Впереди записываем ${carry}.`,
      fact: null,
    });
  }
  return steps;
}

function sumSteps(a, b) {
  const bDigits = String(b).split("").map(Number).reverse();
  const partials = bDigits.map((digit) => String(a * digit).split("").map(Number).reverse());
  const shifts = bDigits.map((_, i) => i);
  let maxCol = 0;
  partials.forEach((digits, i) => {
    maxCol = Math.max(maxCol, digits.length - 1 + shifts[i]);
  });
  const steps = [];
  const autos = [];
  let carry = 0;
  for (let col = 0; col <= maxCol; col += 1) {
    const terms = [];
    for (let i = 0; i < partials.length; i += 1) {
      const idx = col - shifts[i];
      if (idx >= 0 && idx < partials[i].length) terms.push(partials[i][idx]);
    }
    const incoming = carry;
    if (terms.length === 0 && incoming === 0) continue;
    const sum = terms.reduce((s, n) => s + n, 0) + incoming;
    const write = sum % 10;
    const newCarry = Math.floor(sum / 10);
    if (terms.length <= 1 && incoming === 0) {
      autos.push({ fromRight: col, digit: write });
      carry = 0;
      continue;
    }
    const shown = terms.join(" + ");
    const hint = hintSum(terms, incoming, sum, write, newCarry);
    steps.push({
      kind: "sum-write",
      fromRight: col,
      expect: String(write),
      prompt: incoming
        ? `${shown} плюс ${incoming} в${NB}уме. Какую цифру записываем?`
        : `${shown}. Какую цифру записываем?`,
      hint,
      fact: null,
    });
    if (newCarry > 0 && col < maxCol) {
      steps.push({
        kind: "sum-carry",
        fromRight: col + 1,
        expect: String(newCarry),
        prompt: "Сколько запоминаем?",
        hint,
        fact: null,
      });
    }
    carry = newCarry;
  }
  if (carry > 0) {
    steps.push({
      kind: "sum-write",
      fromRight: maxCol + 1,
      expect: String(carry),
      prompt: "Какую цифру записываем впереди?",
      hint: `Впереди записываем ${carry}.`,
      fact: null,
    });
  }
  return { steps, autos };
}

export function columnModel(a, b) {
  const bDigits = String(b).split("").map(Number).reverse();
  const steps = [];
  bDigits.forEach((digit, partial) => {
    steps.push(...partialSteps(a, digit, partial, partial));
  });
  let autos = [];
  if (bDigits.length > 1) {
    const summed = sumSteps(a, b);
    autos = summed.autos;
    steps.push(...summed.steps);
  }
  const sumStart = steps.findIndex((step) => step.kind.startsWith("sum"));
  return {
    a,
    b,
    product: a * b,
    width: String(a * b).length,
    steps,
    autos,
    sumStart,
    partialCount: bDigits.length,
  };
}

export function columnAnswerDigits(model) {
  const row = Array(model.width).fill("");
  const hasSum = model.sumStart >= 0;
  if (!hasSum) {
    for (const step of model.steps) {
      if (step.kind === "partial-write") row[model.width - 1 - step.fromRight] = step.expect;
    }
  } else {
    for (const step of model.steps) {
      if (step.kind === "sum-write") row[model.width - 1 - step.fromRight] = step.expect;
    }
    for (const auto of model.autos) row[model.width - 1 - auto.fromRight] = String(auto.digit);
  }
  return row.join("");
}

function blank(width, small) {
  return Array.from({ length: width }, () => ({ ch: "", on: false, small }));
}

function placeNumber(cells, n) {
  const s = String(n);
  for (let i = 0; i < s.length; i += 1) {
    cells[cells.length - s.length + i].ch = s[i];
  }
}

function rowOf(frame, step) {
  if (step.kind === "partial-write") return frame.partials[step.partial];
  if (step.kind === "partial-carry") return frame.carry;
  if (step.kind === "sum-write") return frame.sum;
  return frame.sumCarry;
}

export function columnFrame(model, done, ghost = "") {
  const { width, steps, autos, sumStart, partialCount } = model;
  const frame = {
    width,
    carry: blank(width, true),
    top: blank(width, false),
    bot: blank(width, false),
    partials: Array.from({ length: partialCount }, () => blank(width, false)),
    sumCarry: blank(width, true),
    sum: blank(width, false),
    showSum: sumStart >= 0 && done >= sumStart,
    partialVisible: Array(partialCount).fill(false),
  };
  placeNumber(frame.top, model.a);
  placeNumber(frame.bot, model.b);
  const firstBot = frame.bot.findIndex((cell) => cell.ch);
  if (firstBot > 0) frame.bot[firstBot - 1].ch = "×";
  else frame.botSign = "×";

  const paint = (step, ch, active) => {
    const col = width - 1 - step.fromRight;
    if (col < 0 || col >= width) return;
    const cell = rowOf(frame, step)[col];
    cell.ch = ch;
    cell.on = active;
  };

  for (let i = 0; i < done && i < steps.length; i += 1) paint(steps[i], steps[i].expect, false);
  if (frame.showSum) {
    for (const auto of autos) {
      const col = width - 1 - auto.fromRight;
      if (col >= 0 && col < width && !frame.sum[col].ch) frame.sum[col].ch = String(auto.digit);
    }
  }
  const current = steps[done] || null;
  if (current) {
    paint(current, ghost, true);
    frame.partialVisible[current.partial] = true;
  }
  for (let i = 0; i < done && i < steps.length; i += 1) {
    if (steps[i].partial != null) frame.partialVisible[steps[i].partial] = true;
  }
  frame.prompt = current ? current.prompt : "Готово";
  frame.current = current;
  return frame;
}
