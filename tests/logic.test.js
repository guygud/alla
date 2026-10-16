import assert from "node:assert/strict";
import test from "node:test";
import { factCandidates, factKey, nextBox, pickFact } from "../js/facts.js";
import { applyResult, emptyState, nextLevel, sessionPlan } from "../js/levels.js";
import { columnAnswerDigits, columnModel, generateColumn } from "../js/column-mul.js";
import { buildDivision, generateDivision } from "../js/long-div.js";

function mulberry32(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("коробка растёт только за быстрый верный ответ и падает в ноль при ошибке", () => {
  assert.equal(nextBox(0, { ok: true, fast: true }), 1);
  assert.equal(nextBox(4, { ok: true, fast: true }), 4);
  assert.equal(nextBox(2, { ok: true, fast: false }), 2);
  assert.equal(nextBox(3, { ok: false, fast: true }), 0);
});

test("слабые факты весят больше выученных", () => {
  const boxes = {};
  for (const item of factCandidates(0, {})) boxes[item.key] = 4;
  boxes[factKey(2, 7)] = 0;
  const list = factCandidates(0, boxes);
  const weak = list.find((item) => item.key === "2*7");
  const strong = list.find((item) => item.key === "2*3");
  assert.ok(weak.w > strong.w);
});

test("примеры таблицы остаются внутри уровня", () => {
  const rand = mulberry32(3);
  for (let i = 0; i < 200; i += 1) {
    const problem = pickFact({}, 0, rand);
    const pool = [2, 5, 10];
    assert.ok(pool.includes(problem.a) || pool.includes(problem.b));
    if (problem.op === "mul") assert.equal(problem.answer, problem.left * problem.right);
    else assert.equal(problem.left, problem.answer * problem.right);
    assert.equal(problem.key, factKey(problem.a, problem.b));
  }
});

test("уровень растёт после точного и быстрого окна и падает после серии ошибок", () => {
  const fast = Array.from({ length: 15 }, () => ({ ok: true, ms: 1000 }));
  assert.equal(nextLevel("facts", 0, fast).change, "up");
  assert.equal(nextLevel("facts", 0, fast).level, 1);

  const slow = Array.from({ length: 15 }, () => ({ ok: true, ms: 20000 }));
  assert.equal(nextLevel("facts", 0, slow).change, null);

  const almost = Array.from({ length: 15 }, (_, i) => ({ ok: i % 8 !== 0, ms: 1000 }));
  assert.equal(nextLevel("facts", 0, almost).change, null);

  const streak = [{ ok: true, ms: 1000 }, { ok: false, ms: 1000 }, { ok: false, ms: 1000 }, { ok: false, ms: 1000 }, { ok: false, ms: 1000 }];
  const down = nextLevel("column", 2, streak);
  assert.equal(down.change, "down");
  assert.equal(down.level, 1);
  assert.deepEqual(down.recent, []);
});

test("серия ошибок в занятии понижает уровень один раз", () => {
  let state = emptyState();
  state = { ...state, levels: { ...state.levels, facts: 2 } };
  for (let i = 0; i < 4; i += 1) {
    state = applyResult(state, "facts", { ok: false, ms: 3000, factKey: "6*7" }).state;
  }
  assert.equal(state.levels.facts, 1);
  assert.equal(state.boxes["6*7"], 0);
  assert.equal(state.stats["6*7"].bad, 4);
});

test("план занятия: таблица, два столбика и одно деление", () => {
  const plan = sessionPlan();
  assert.equal(plan.length, 13);
  assert.equal(plan.filter((mode) => mode === "column").length, 2);
  assert.equal(plan.filter((mode) => mode === "division").length, 1);
});

test("столбик сходится с произведением на всех уровнях", () => {
  const rand = mulberry32(11);
  for (let level = 0; level <= 4; level += 1) {
    for (let i = 0; i < 40; i += 1) {
      const problem = generateColumn(level, rand);
      const model = columnModel(problem.a, problem.b);
      assert.equal(model.product, problem.a * problem.b);
      assert.equal(columnAnswerDigits(model), String(problem.a * problem.b));
      for (const step of model.steps) {
        assert.equal(step.expect.length, 1);
        assert.ok(step.fromRight >= 0);
        assert.ok(step.fromRight < model.width);
      }
      if (level === 0) {
        assert.equal(model.steps.some((step) => step.kind.includes("carry")), false);
        assert.equal(String(problem.a).length, 2);
        assert.equal(String(problem.b).length, 1);
      }
      if (level === 1) assert.equal(model.steps.some((step) => step.kind === "partial-carry"), true);
    }
  }
});

test("фиксированный столбик 23 × 14 даёт 322", () => {
  const model = columnModel(23, 14);
  assert.equal(columnAnswerDigits(model), "322");
  assert.ok(model.steps.some((step) => step.kind === "sum-write"));
});

test("деление строится из частного и остатка, шаги сходятся", () => {
  const rand = mulberry32(21);
  for (let level = 0; level <= 3; level += 1) {
    for (let i = 0; i < 40; i += 1) {
      const problem = generateDivision(level, rand);
      const model = buildDivision(problem.dividend, problem.divisor);
      assert.equal(problem.dividend, model.quotient * model.divisor + model.remainder);
      assert.equal(model.quotientText, String(model.quotient));
      assert.equal(model.remainder, problem.dividend % problem.divisor);
      if (level < 2) assert.equal(model.remainder, 0);
      if (level === 2) assert.ok(model.remainder > 0);
      for (const step of model.steps) {
        if (step.kind === "mul") assert.equal(Number(step.expect), step.fact.a * step.fact.b);
        if (step.kind === "digit") {
          assert.equal(Number(step.expect), Math.floor(step.into / problem.divisor));
        }
        if (step.kind === "sub") {
          const [left, right] = step.prompt.replace(" = ?", "").split(" − ").map(Number);
          assert.equal(Number(step.expect), left - right);
        }
        assert.ok(step.frame);
      }
      const last = model.steps.at(-1);
      assert.equal(last.kind, "rem");
      assert.equal(last.expect, String(model.remainder));
      assert.equal(last.frame.quotient, model.quotientText);
    }
  }
});

test("уголок 156 : 12 показывает частное 13 и остаток 0", () => {
  const model = buildDivision(156, 12);
  assert.equal(model.quotientText, "13");
  const rem = model.steps.at(-1).frame;
  const texts = rem.rows.filter((row) => !row.line).map((row) => row.cells.join(""));
  assert.deepEqual(texts, ["156", "12", "36", "36", "0"]);
  assert.equal(rem.rows[1].minus, true);
  assert.equal(rem.rows[4].minus, true);
});
