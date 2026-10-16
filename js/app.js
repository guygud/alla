import { loginProfile, saveProgress } from "./api.js";
import { columnFrame, columnModel, generateColumn } from "./column-mul.js";
import { factHint, factKey, factMaxLen, factPrompt, pickFact } from "./facts.js";
import { renderKeypad } from "./keypad.js";
import {
  LEVEL_NAMES,
  MODE_META,
  MODE_TITLE,
  SESSION_MS,
  applyResult,
  emptyState,
  levelNote,
  normalizeState,
  sessionPlan,
} from "./levels.js";
import { buildDivision, generateDivision } from "./long-div.js";
import { freshData, loadLocal, saveLocal } from "./storage.js";
import { el } from "./ui.js";

const NB = "\u00A0";
const NAME_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё -]{0,22}[A-Za-zА-Яа-яЁё]$/;

const ERRORS = {
  bad_pin: "Код не подошёл. Проверь цифры и попробуй ещё раз.",
  locked: "Слишком много попыток. Подожди минуту.",
  bad_name: "Имя нужно из букв, от 2 до 24.",
  not_found: "Такого имени ещё нет.",
};

let data = loadLocal() || freshData();
data.state = normalizeState(data.state);

let ui = {
  screen: data.profile ? "home" : "login",
  login: { name: data.profile?.name || "", pin: "", error: "", busy: false, phase: "name" },
  drill: null,
  summary: null,
  note: null,
  status: "",
};

let clock = 0;
let syncing = false;

function persist() {
  saveLocal(data);
}

function render() {
  clearInterval(clock);
  const root = document.getElementById("app");
  let page = null;
  if (ui.screen === "login") page = loginScreen();
  else if (ui.screen === "home") page = homeScreen();
  else if (ui.screen === "drill") page = drillScreen();
  else if (ui.screen === "note") page = noteScreen();
  else page = summaryScreen();
  root.replaceChildren(page);
  document.getElementById("name")?.focus();
  if (ui.screen === "drill") clock = setInterval(tickChrome, 1000);
}

function tickChrome() {
  if (ui.screen !== "drill" || !ui.drill) return;
  const session = ui.drill.session;
  const clockNode = document.getElementById("clock");
  if (clockNode && session) {
    const left = Math.max(0, SESSION_MS - (Date.now() - session.startedAt));
    clockNode.textContent = `Занятие · ${clockText(left)}`;
  }
  const bar = document.getElementById("timebar");
  if (bar && ui.drill.mode === "facts") {
    const limit = MODE_META.facts.times[data.state.levels.facts];
    const ratio = Math.max(0, 1 - (Date.now() - ui.drill.startedAt) / limit);
    bar.style.width = `${Math.round(ratio * 100)}%`;
    bar.parentElement.classList.toggle("late", ratio <= 0);
  }
}

function loginScreen() {
  const login = ui.login;
  const pinPhase = login.phase === "pin";
  return el("div", { class: "page" },
    el("header", { class: "top" }, el("p", { class: "brand" }, "Тренажёр")),
    el("main", {},
      el("h1", {}, pinPhase ? "Код из 4 цифр" : "Как тебя зовут?"),
      el("p", { class: "lead" }, pinPhase
        ? `Код нужен, чтобы открыть тренажёр на телефоне и${NB}на планшете.`
        : "Умножение, столбик и деление уголком."),
      pinPhase
        ? el("div", { class: "dots" }, [0, 1, 2, 3].map((i) => el("i", { class: `dot${i < login.pin.length ? " fill" : ""}` })))
        : el("input", {
          class: "field",
          id: "name",
          value: login.name,
          maxlength: "24",
          autocomplete: "name",
          autocapitalize: "words",
          placeholder: "Имя",
          onkeydown: (event) => { if (event.key === "Enter") onName(); },
        }),
      el("p", { class: "error" }, login.error),
      pinPhase
        ? el("button", { class: "text", type: "button", onclick: () => { login.phase = "name"; login.pin = ""; login.error = ""; render(); } }, "Назад")
        : el("button", { class: "primary", type: "button", disabled: login.busy, onclick: onName }, "Далее"),
    ),
    pinPhase ? renderKeypad({
      disabled: login.busy,
      okLabel: "Войти",
      onDigit: (digit) => {
        if (login.pin.length >= 4 || login.busy) return;
        login.pin += digit;
        login.error = "";
        render();
        if (login.pin.length === 4) submitLogin();
      },
      onBack: () => {
        login.pin = login.pin.slice(0, -1);
        render();
      },
      onOk: submitLogin,
    }) : null,
  );
}

function onName() {
  const input = document.getElementById("name");
  const name = (input?.value || "").trim();
  if (!NAME_RE.test(name)) {
    ui.login.error = "Напиши имя буквами, хотя бы две.";
    ui.login.name = name;
    render();
    return;
  }
  ui.login.name = name;
  ui.login.phase = "pin";
  ui.login.pin = "";
  ui.login.error = "";
  render();
}

async function submitLogin() {
  const login = ui.login;
  if (login.busy || login.pin.length !== 4) return;
  login.busy = true;
  login.error = "";
  render();
  try {
    const res = await loginProfile(login.name, login.pin);
    if (!res?.ok) {
      login.busy = false;
      login.pin = "";
      login.error = ERRORS[res?.error] || "Не получилось войти.";
      render();
      return;
    }
    adoptLogin(res, login.pin);
    ui.screen = "home";
    ui.status = "";
    persist();
    render();
  } catch {
    const same = data.profile && data.profile.name.toLowerCase() === login.name.toLowerCase();
    data.profile = { name: login.name.trim(), pin: login.pin };
    if (!same) data.state = emptyState();
    data.pendingCreate = true;
    ui.screen = "home";
    ui.status = "Интернета нет. Занятие сохранится на устройстве.";
    login.busy = false;
    persist();
    render();
  }
}

function adoptLogin(res, pin) {
  const same = data.profile && data.profile.name.toLowerCase() === String(res.name || "").toLowerCase();
  data.profile = { name: res.name, pin };
  data.pendingCreate = false;
  if (!(same && data.queue.length)) {
    data.state = normalizeState(res.state);
    if (res.updated_at) data.state.updatedAt = res.updated_at;
    data.queue = same ? data.queue : [];
  }
}

function homeScreen() {
  const levels = data.state.levels;
  return el("div", { class: "page" },
    el("header", { class: "top" },
      el("p", { class: "brand" }, "Тренажёр"),
      el("button", { class: "text", type: "button", onclick: switchName }, "Сменить имя"),
    ),
    el("main", {},
      el("h1", {}, `Привет, ${data.profile.name}`),
      ui.status ? el("p", { class: "quiet" }, ui.status) : null,
      data.queue.length ? el("p", { class: "quiet" }, "Есть ответы, которые ещё не отправились.") : null,
      el("div", { class: "stack" },
        el("button", { class: "primary", type: "button", onclick: startSession }, "Начать занятие"),
        el("p", { class: "quiet" }, `10 минут: таблица, столбик и${NB}уголок.`),
        modeCard("facts", levels.facts, () => startFree("facts")),
        modeCard("column", levels.column, () => startFree("column")),
        modeCard("division", levels.division, () => startFree("division")),
        el("a", { class: "linkish", href: "parent.html" }, "Для родителей"),
      ),
    ),
  );
}

function modeCard(mode, level, onclick) {
  return el("button", { class: "card", type: "button", onclick },
    el("b", {}, MODE_TITLE[mode]),
    el("span", {}, LEVEL_NAMES[mode][level]));
}

async function switchName() {
  await sync();
  ui.login = { name: "", pin: "", error: "", busy: false, phase: "name" };
  ui.screen = "login";
  render();
}

function startSession() {
  ui.drill = {
    session: {
      tasks: sessionPlan(),
      cursor: 0,
      startedAt: Date.now(),
      tally: { facts: { ok: 0, bad: 0 }, column: { ok: 0, bad: 0 }, division: { ok: 0, bad: 0 } },
      notes: [],
    },
  };
  beginProblem(ui.drill.session.tasks[0]);
}

function startFree(mode) {
  ui.drill = { session: null };
  beginProblem(mode);
}

function beginProblem(mode) {
  const level = data.state.levels[mode];
  let problem;
  if (mode === "facts") problem = pickFact(data.state.boxes, level);
  else if (mode === "column") {
    const generated = generateColumn(level);
    problem = columnModel(generated.a, generated.b);
  } else {
    const generated = generateDivision(level);
    problem = buildDivision(generated.dividend, generated.divisor);
  }
  Object.assign(ui.drill, {
    mode,
    problem,
    step: 0,
    entry: "",
    startedAt: Date.now(),
    missed: false,
    weak: new Set(),
    feedback: null,
  });
  ui.screen = "drill";
  render();
}

function drillScreen() {
  const drill = ui.drill;
  const session = drill.session;
  const left = session ? Math.max(0, SESSION_MS - (Date.now() - session.startedAt)) : 0;
  const title = session ? `Занятие · ${clockText(left)}` : MODE_TITLE[drill.mode];
  const sub = session
    ? `${session.cursor + 1} из ${session.tasks.length}`
    : LEVEL_NAMES[drill.mode][data.state.levels[drill.mode]];
  const step = drill.mode === "facts" ? null : drill.problem.steps[drill.step];
  const info = step && step.expect == null;
  return el("div", { class: "page drill-page" },
    el("header", { class: "top" },
      el("button", { class: "text", type: "button", onclick: goHome }, "На главную"),
      el("div", {},
        el("div", { id: session ? "clock" : undefined }, title),
        el("div", { class: "quiet" }, sub),
      ),
    ),
    el("main", {},
      el("div", { class: "stage" },
        drill.mode === "facts" ? factsView(drill) : null,
        drill.mode === "column" ? columnView(drill) : null,
        drill.mode === "division" ? divisionView(drill) : null,
        drill.feedback ? el("p", { class: "hint" }, drill.feedback) : null,
      ),
    ),
    renderKeypad({
      digits: !info,
      okLabel: info ? "Далее" : "Готово",
      onDigit: onDigit,
      onBack: onBack,
      onOk: () => submitEntry(false),
    }),
  );
}

function factsView(drill) {
  const limit = MODE_META.facts.times[data.state.levels.facts];
  const ratio = Math.max(0, 1 - (Date.now() - drill.startedAt) / limit);
  return el("div", { class: "stage" },
    el("div", { class: "eq", "aria-live": "polite" },
      el("span", {}, factPrompt(drill.problem)),
      el("span", {}, "="),
      el("span", { class: `slot${drill.feedback ? " bad" : ""}` }, drill.entry || NB),
    ),
    el("div", { class: `bar${ratio <= 0 ? " late" : ""}` }, el("i", { id: "timebar", style: `width:${Math.round(ratio * 100)}%` })),
  );
}

function columnView(drill) {
  const frame = columnFrame(drill.problem, drill.step, drill.entry);
  return el("div", { class: "stage" },
    el("p", { class: "ask", "aria-live": "polite" }, frame.prompt),
    renderSheet(frame),
  );
}

function renderSheet(frame) {
  const rows = [
    sheetRow(frame.carry, "carry"),
    sheetRow(frame.top),
    sheetRow(frame.bot, "", frame.botSign || ""),
    el("div", { class: "sline", style: `--n:${frame.width}` }),
  ];
  frame.partials.forEach((row, index) => {
    if (frame.partialVisible[index]) rows.push(sheetRow(row));
  });
  if (frame.showSum) {
    rows.push(el("div", { class: "sline", style: `--n:${frame.width}` }));
    rows.push(sheetRow(frame.sumCarry, "carry"));
    rows.push(sheetRow(frame.sum));
  }
  return el("div", { class: "sheet", style: `--n:${frame.width}` }, rows);
}

function sheetRow(cells, extra = "", sign = "") {
  return el("div", { class: `srow ${extra}`, style: `--n:${cells.length}` },
    el("span", { class: "gutter" }, sign),
    cells.map((cell) => el("span", { class: cellClass(cell) }, cell.ch || NB)));
}

function cellClass(cell) {
  const names = ["cell"];
  if (cell.on) names.push("on");
  if (cell.ch === "×") names.push("sign");
  return names.join(" ");
}

function divisionView(drill) {
  const step = drill.problem.steps[drill.step];
  const showEntry = step.expect != null;
  return el("div", { class: "stage" },
    el("p", { class: "ask", "aria-live": "polite" }, step.prompt),
    renderCorner(step.frame),
    showEntry ? el("div", { class: `entry${drill.feedback ? " slot bad" : ""}` }, drill.entry || NB) : null,
  );
}

function renderCorner(frame) {
  return el("div", { class: "corner", style: `--n:${frame.width}` },
    el("div", { class: "work" }, frame.rows.map((row) => {
      if (row.line) return el("div", { class: "dline", style: `--n:${frame.width}` });
      return el("div", { class: "drow", style: `--n:${frame.width}` },
        el("span", { class: "gutter" }, row.minus ? "−" : ""),
        (row.cells || []).map((ch) => el("span", { class: "cell" }, ch || NB)));
    })),
    el("div", { class: "panel" },
      el("div", { class: "divisor" }, frame.divisor),
      el("div", { class: "qline" }),
      el("div", { class: "quotient" }, frame.quotient || NB),
    ),
  );
}

function onDigit(digit) {
  const drill = ui.drill;
  if (!drill) return;
  const step = drill.mode === "facts" ? null : drill.problem.steps[drill.step];
  if (step && step.expect == null) return;
  const max = drill.mode === "facts" ? factMaxLen(drill.problem) : step.expect.length;
  if (drill.entry.length >= max) return;
  drill.feedback = null;
  drill.entry += digit;
  if (drill.entry.length >= max) submitEntry(true);
  else render();
}

function onBack() {
  if (!ui.drill || !ui.drill.entry) return;
  ui.drill.entry = ui.drill.entry.slice(0, -1);
  ui.drill.feedback = null;
  render();
}

function submitEntry() {
  const drill = ui.drill;
  if (!drill) return;
  const step = drill.mode === "facts" ? null : drill.problem.steps[drill.step];
  if (step && step.expect == null) {
    drill.step += 1;
    drill.entry = "";
    drill.feedback = null;
    if (drill.step >= drill.problem.steps.length) finishProblem();
    else render();
    return;
  }
  const expect = drill.mode === "facts" ? String(drill.problem.answer) : step.expect;
  if (!drill.entry) return;
  if (drill.entry === expect) {
    drill.entry = "";
    drill.feedback = null;
    if (drill.mode === "facts") finishProblem();
    else {
      drill.step += 1;
      if (drill.step >= drill.problem.steps.length) finishProblem();
      else render();
    }
    return;
  }
  drill.missed = true;
  rememberWeak(step);
  drill.feedback = drill.mode === "facts" ? factHint(drill.problem) : step.hint;
  drill.entry = "";
  if (navigator.vibrate) navigator.vibrate(25);
  render();
}

function rememberWeak(step) {
  const fact = step?.fact;
  if (!fact) return;
  if (fact.table === false) return;
  if (fact.a >= 2 && fact.a <= 10 && fact.b >= 2 && fact.b <= 10) {
    ui.drill.weak.add(factKey(fact.a, fact.b));
  }
}

function finishProblem() {
  const drill = ui.drill;
  const ms = Date.now() - drill.startedAt;
  const ok = !drill.missed;
  const fact = drill.mode === "facts" ? drill.problem.key : null;
  const result = applyResult(data.state, drill.mode, {
    ok,
    ms,
    factKey: fact,
    weakKeys: [...drill.weak],
  });
  data.state = result.state;
  data.queue.push({
    id: crypto.randomUUID(),
    mode: drill.mode,
    ok,
    ms,
    at: new Date().toISOString(),
    detail: detailOf(drill),
  });
  if (drill.session) {
    const slot = drill.session.tally[drill.mode];
    slot.ok += ok ? 1 : 0;
    slot.bad += ok ? 0 : 1;
    if (result.change) drill.session.notes.push(levelNote(drill.mode, result.change, result.level));
  }
  persist();
  sync();
  if (result.change) {
    ui.note = { text: levelNote(drill.mode, result.change, result.level) };
    ui.screen = "note";
    render();
    return;
  }
  advance();
}

function detailOf(drill) {
  if (drill.mode === "facts") {
    return { a: drill.problem.a, b: drill.problem.b, op: drill.problem.op };
  }
  if (drill.mode === "column") return { a: drill.problem.a, b: drill.problem.b };
  return { dividend: drill.problem.dividend, divisor: drill.problem.divisor };
}

function advance() {
  const session = ui.drill?.session;
  if (!session) {
    beginProblem(ui.drill.mode);
    return;
  }
  session.cursor += 1;
  const expired = Date.now() - session.startedAt >= SESSION_MS;
  if (expired || session.cursor >= session.tasks.length) {
    ui.summary = { tally: session.tally, notes: session.notes.slice(), expired };
    ui.drill = null;
    ui.screen = "summary";
    render();
    return;
  }
  beginProblem(session.tasks[session.cursor]);
}

function noteScreen() {
  return el("div", { class: "page" },
    el("main", { class: "note" },
      el("h1", {}, "Уровень"),
      el("p", { class: "lead" }, ui.note.text),
      el("button", { class: "primary", type: "button", onclick: advance }, "Далее"),
    ),
  );
}

function summaryScreen() {
  const { tally, notes, expired } = ui.summary;
  const rows = ["facts", "column", "division"].map((mode) => {
    const slot = tally[mode];
    const total = slot.ok + slot.bad;
    if (!total) return null;
    return el("div", { class: "stat" },
      el("span", {}, MODE_TITLE[mode]),
      el("b", {}, `${slot.ok} из ${total}`));
  });
  return el("div", { class: "page" },
    el("main", { class: "summary" },
      el("h1", {}, "Занятие готово"),
      el("p", { class: "lead" }, expired
        ? "Десять минут прошли. Этого достаточно на сегодня."
        : "Все примеры из занятия сделаны."),
      ...rows,
      ...notes.map((text) => el("p", { class: "quiet" }, text)),
      el("button", { class: "primary", type: "button", onclick: goHome, style: "margin-top:18px" }, "На главную"),
    ),
  );
}

function goHome() {
  ui.drill = null;
  ui.note = null;
  ui.summary = null;
  ui.screen = data.profile ? "home" : "login";
  render();
}

function clockText(ms) {
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

async function sync() {
  if (syncing || !data.profile || !navigator.onLine) return;
  syncing = true;
  const batch = data.queue.slice();
  const sentAt = data.state.updatedAt;
  try {
    if (data.pendingCreate) {
      const logged = await loginProfile(data.profile.name, data.profile.pin);
      if (!logged?.ok) {
        ui.status = ERRORS[logged?.error] || "Не получилось сохранить прогресс.";
        return;
      }
      data.profile.name = logged.name;
      data.pendingCreate = false;
    }
    const res = await saveProgress(data.profile.name, data.profile.pin, data.state, batch);
    if (!res?.ok) {
      ui.status = ERRORS[res?.error] || "Не получилось сохранить прогресс.";
      return;
    }
    const sent = new Set(batch.map((item) => item.id));
    data.queue = data.queue.filter((item) => !sent.has(item.id));
    const serverTime = Date.parse(res.updated_at);
    const localTime = Date.parse(sentAt);
    if (Number.isFinite(serverTime) && serverTime > localTime + 500 && data.queue.length === 0) {
      data.state = normalizeState(res.state);
      data.state.updatedAt = res.updated_at;
    }
    ui.status = "";
    persist();
  } catch {
    ui.status = "Ответы пока на этом устройстве.";
  } finally {
    syncing = false;
    if (ui.screen === "home") render();
  }
}

function boot() {
  const host = location.hostname;
  if ("serviceWorker" in navigator && host !== "localhost" && host !== "127.0.0.1") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  window.addEventListener("online", sync);
  render();
  if (data.profile) sync();
}

boot();
