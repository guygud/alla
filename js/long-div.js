function randInt(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pickQuotient(rand, divisor, minQ, maxQ, minProduct, maxProduct) {
  const qMin = Math.max(minQ, Math.ceil(minProduct / divisor));
  const qMax = Math.min(maxQ, Math.floor(maxProduct / divisor));
  if (qMin > qMax) return null;
  return randInt(rand, qMin, qMax);
}

export function generateDivision(level, rand = Math.random) {
  const lv = Math.max(0, Math.min(3, level | 0));
  for (let i = 0; i < 60; i += 1) {
    if (lv === 0) {
      const divisor = randInt(rand, 2, 9);
      const q = pickQuotient(rand, divisor, 2, 9, 10, 99);
      if (!q) continue;
      return { dividend: q * divisor, divisor, level: 0 };
    }
    if (lv === 1) {
      const divisor = randInt(rand, 2, 9);
      const q = pickQuotient(rand, divisor, 10, 99, 100, 999);
      if (!q) continue;
      return { dividend: q * divisor, divisor, level: 1 };
    }
    if (lv === 2) {
      const divisor = randInt(rand, 2, 9);
      const q = pickQuotient(rand, divisor, 10, 99, 100, 980);
      if (!q) continue;
      const rem = randInt(rand, 1, divisor - 1);
      const dividend = q * divisor + rem;
      if (dividend > 999) continue;
      return { dividend, divisor, level: 2 };
    }
    const divisor = randInt(rand, 12, 24);
    const q = pickQuotient(rand, divisor, 12, 24, 100, 999);
    if (!q) continue;
    return { dividend: q * divisor, divisor, level: 3 };
  }
  if (lv === 0) return { dividend: 48, divisor: 6, level: 0 };
  if (lv === 1) return { dividend: 156, divisor: 6, level: 1 };
  if (lv === 2) return { dividend: 157, divisor: 6, level: 2 };
  return { dividend: 168, divisor: 12, level: 3 };
}

function blank(width) {
  return Array(width).fill("");
}

function placeAt(cells, endIndex, value) {
  const s = String(value);
  for (let k = 0; k < s.length; k += 1) {
    cells[endIndex - s.length + 1 + k] = s[k];
  }
}

export function buildDivision(dividend, divisor) {
  const digits = String(dividend).split("").map(Number);
  const width = digits.length;
  const rows = [{ cells: digits.map(String), minus: false, line: false }];
  let quotient = "";
  const steps = [];
  let current = 0;
  let started = false;

  const snap = () => ({
    width,
    divisor: String(divisor),
    quotient,
    rows: rows.map((row) => ({
      minus: !!row.minus,
      line: !!row.line,
      cells: row.line ? null : [...row.cells],
    })),
  });

  for (let i = 0; i < digits.length; i += 1) {
    current = current * 10 + digits[i];
    if (!started && current < divisor && i < digits.length - 1) {
      steps.push({
        kind: "next",
        prompt: `${current} меньше ${divisor}, берём ещё цифру.`,
        expect: null,
        hint: "",
        frame: snap(),
      });
      continue;
    }
    started = true;
    const into = current;
    const qDigit = Math.floor(into / divisor);
    const prod = qDigit * divisor;
    steps.push({
      kind: "digit",
      prompt: `Сколько раз ${divisor} помещается в ${into}?`,
      expect: String(qDigit),
      hint: `${divisor} × ${qDigit} = ${prod}. В${"\u00A0"}частном пишем ${qDigit}.`,
      into,
      frame: snap(),
    });
    quotient += String(qDigit);

    if (qDigit !== 0) {
      const table = qDigit >= 2 && qDigit <= 9 && divisor >= 2 && divisor <= 9;
      steps.push({
        kind: "mul",
        prompt: `${qDigit} × ${divisor} = ?`,
        expect: String(prod),
        hint: `${qDigit} × ${divisor} = ${prod}.`,
        fact: { a: qDigit, b: divisor, table },
        frame: snap(),
      });
      const prodCells = blank(width);
      placeAt(prodCells, i, prod);
      rows.push({ cells: prodCells, minus: true, line: false });
      rows.push({ cells: null, minus: false, line: true });
      steps.push({
        kind: "sub",
        prompt: `${into} − ${prod} = ?`,
        expect: String(into - prod),
        hint: `${into} − ${prod} = ${into - prod}.`,
        frame: snap(),
      });
      const diffCells = blank(width);
      placeAt(diffCells, i, into - prod);
      rows.push({ cells: diffCells, minus: false, line: false });
      current = into - prod;
    }

    if (i < digits.length - 1) {
      const nextDigit = digits[i + 1];
      const nextVal = current * 10 + nextDigit;
      let work = rows[rows.length - 1];
      if (!work || work.line || work.minus) {
        const cells = blank(width);
        placeAt(cells, i, current);
        rows.push({ cells, minus: false, line: false });
        work = rows[rows.length - 1];
      }
      const hint = current === 0
        ? `Сносим ${nextDigit}. Получается ${nextVal}.`
        : `К${"\u00A0"}${current} сносим ${nextDigit}. Получается ${nextVal}.`;
      steps.push({
        kind: "down",
        prompt: `Сносим ${nextDigit}. Какое число получится?`,
        expect: String(nextVal),
        hint,
        frame: snap(),
      });
      if (current === 0) {
        for (let c = 0; c < width; c += 1) {
          if (work.cells[c] === "0") work.cells[c] = "";
        }
      }
      work.cells[i + 1] = String(nextDigit);
    }
  }

  steps.push({
    kind: "rem",
    prompt: "Какой остаток?",
    expect: String(dividend % divisor),
    hint: `Остаток ${dividend % divisor}.`,
    frame: snap(),
  });

  return {
    dividend,
    divisor,
    quotient: Math.floor(dividend / divisor),
    remainder: dividend % divisor,
    quotientText: quotient,
    steps,
  };
}
