import { dropPush, loginProfile, saveProgress, savePush } from "./api.js";
import { columnFrame, columnModel, generateColumn } from "./column-mul.js";
import { factHint, factKey, factMaxLen, factPrompt, pickFact } from "./facts.js";
import { renderKeypad } from "./keypad.js";
import {
  LEVEL_NAMES,
  MODE_META,
  MODE_TITLE,
  MODES,
  SESSION_MS,
  applyResult,
  contributionLines,
  dayTotals,
  emptyState,
  grantNextStar,
  levelNote,
  moscowDay,
  normalizeState,
  practiceCount,
  progressLine,
  recordPractice,
  reviewLength,
  reviewTarget,
  sessionBlurb,
  sessionPlan,
  sessionStillOpen,
  nextSessionMode,
  starCap,
  starMarks,
  starTotal,
  touchStarDate,
  weekMarks,
  windowProgress,
} from "./levels.js";
import { FALLBACK, STICKERS, reactionFor, stickerLockText, stickerUnlocked, unlockedStickers } from "./mascot.js";
import { buildDivision, generateDivision } from "./long-div.js";
import { VAPID_PUBLIC_KEY, vapidKeyBytes } from "./push.js";
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
  remindBusy: false,
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
  else if (ui.screen === "stickers") page = stickersScreen();
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
    const limit = MODE_META.facts.times[ui.drill.level ?? data.state.levels.facts];
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
  if (!same) {
    data.remind = false;
    data.pushEndpoint = "";
  }
}

function homeScreen() {
  const state = data.state;
  const levels = state.levels;
  const total = starTotal(state);
  const latest = unlockedStickers(total, practiceCount(state)).at(-1);
  const day = moscowDay();
  const today = dayTotals(state, day);
  const week = weekMarks(state, day);
  const sessions = week.filter((item) => item.active).length;
  return el("div", { class: "page" },
    el("header", { class: "top" },
      el("p", { class: "brand" }, "Тренажёр"),
      el("button", { class: "text", type: "button", onclick: switchName }, "Сменить имя"),
    ),
    el("main", {},
      el("div", { class: "hero" },
        mascotImg(latest, "mascot"),
        el("div", {},
          el("h1", {}, `Привет, ${data.profile.name}`),
          el("p", { class: "quiet" }, today.total
            ? `Сегодня: ${today.total} ${examplesWord(today.total)}, ${today.ok} верно.`
            : "Сегодня ещё не было примеров."),
        ),
      ),
      ui.status ? el("p", { class: "quiet" }, ui.status) : null,
      data.queue.length ? el("p", { class: "quiet" }, "Есть ответы, которые ещё не отправились.") : null,
      el("div", { class: "week" }, week.map((item) => el("i", {
        class: `${item.active ? "on" : ""}${item.today ? " today" : ""}`,
      }, item.label))),
      el("p", { class: "quiet" }, `Занятий на этой неделе: ${sessions}.`),
      starBar("Звёзды", total, starCap()),
      ...MODES.map((mode) => starBar(MODE_TITLE[mode], starTotal(state, mode), starCap(mode))),
      el("button", { class: "text stickers-link", type: "button", onclick: () => { ui.screen = "stickers"; render(); } }, "Наклейки"),
      el("div", { class: "stack" },
        el("button", { class: "primary", type: "button", onclick: startSession }, "Начать занятие"),
        el("p", { class: "quiet" }, sessionBlurb(state)),
        el("button", {
          class: "text",
          type: "button",
          disabled: ui.remindBusy,
          onclick: data.remind ? disableReminders : enableReminders,
        }, data.remind ? "Выключить напоминания" : "Напоминать"),
        data.remind ? el("p", { class: "quiet" }, `Каждый день в${NB}18:00, если примеров ещё не было.`) : null,
        modeCard("facts", levels.facts, () => startFree("facts")),
        modeCard("column", levels.column, () => startFree("column")),
        modeCard("division", levels.division, () => startFree("division")),
        el("a", { class: "linkish", href: "parent.html" }, "Для родителей"),
      ),
    ),
  );
}

function modeCard(mode, level, onclick) {
  const progress = windowProgress(mode, level, data.state.recent[mode]);
  const ratio = progress.need ? Math.round((progress.have / progress.need) * 100) : 0;
  return el("button", { class: "card", type: "button", onclick },
    el("span", { class: "card-main" },
      el("b", {}, MODE_TITLE[mode]),
      starRow(data.state, mode, level),
      el("span", { class: "quiet" }, `${progress.have} из ${progress.need}, ошибок ${progress.errors}, можно ${progress.allowedErrors}`),
      el("span", { class: "bar thin" }, el("i", { style: `width:${ratio}%` })),
    ),
    el("span", {}, LEVEL_NAMES[mode][level]));
}

function starRow(state, mode, level) {
  const day = moscowDay();
  return el("span", { class: "stars" }, starMarks(state, mode, level, day).map((mark) => el("i", {
    class: `${mark.on ? "on" : ""}${mark.fresh ? " fresh" : ""}`,
  }, mark.on ? "★" : "☆")));
}

function starBar(label, value, max) {
  const ratio = max ? Math.round((value / max) * 100) : 0;
  return el("div", { class: "meter" },
    el("div", { class: "meter-top" },
      el("span", {}, label),
      el("b", {}, `${value} из ${max}`),
    ),
    el("div", { class: "bar thin" }, el("i", { style: `width:${ratio}%` })),
  );
}

function currentStickers() {
  return unlockedStickers(starTotal(data.state), practiceCount(data.state));
}

function examplesWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "пример";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "примера";
  return "примеров";
}

function mascotImg(sticker, className) {
  return el("img", {
    class: className || "mascot",
    src: sticker?.src || FALLBACK,
    alt: sticker?.title || "Пушин",
    onerror: (event) => {
      const img = event.currentTarget;
      if (img.dataset.fallback) return;
      img.dataset.fallback = "1";
      img.src = FALLBACK;
    },
  });
}

async function switchName() {
  await sync();
  ui.login = { name: "", pin: "", error: "", busy: false, phase: "name" };
  ui.screen = "login";
  render();
}

async function enableReminders() {
  if (ui.remindBusy || !data.profile) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    ui.status = "Этот браузер не умеет напоминания.";
    render();
    return;
  }
  ui.remindBusy = true;
  ui.status = "";
  render();
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      ui.status = "Разреши уведомления в настройках телефона.";
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      ui.status = "Обнови страницу и попробуй ещё раз.";
      return;
    }
    const ready = await navigator.serviceWorker.ready;
    let sub = await ready.pushManager.getSubscription();
    if (!sub) {
      sub = await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const res = await savePush(
      data.profile.name,
      data.profile.pin,
      json.endpoint,
      json.keys?.p256dh,
      json.keys?.auth,
    );
    if (!res?.ok) {
      ui.status = ERRORS[res?.error] || "Не получилось включить напоминание. Попробуй ещё раз.";
      return;
    }
    data.remind = true;
    data.pushEndpoint = json.endpoint;
    ui.status = `Напоминание каждый день в${NB}18:00.`;
    persist();
  } catch {
    ui.status = "Не получилось включить напоминание. Попробуй ещё раз.";
  } finally {
    ui.remindBusy = false;
    if (ui.screen === "home") render();
  }
}

async function disableReminders() {
  if (ui.remindBusy || !data.profile) return;
  ui.remindBusy = true;
  ui.status = "";
  render();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint || data.pushEndpoint || "";
    if (sub) await sub.unsubscribe();
    if (endpoint) {
      try {
        await dropPush(data.profile.name, data.profile.pin, endpoint);
      } catch {
        ui.status = "Напоминание выключено на телефоне. На сервере оно выключится само.";
      }
    }
    data.remind = false;
    data.pushEndpoint = "";
    if (!ui.status) ui.status = "Напоминание выключено.";
    persist();
  } catch {
    ui.status = "Не получилось выключить напоминание. Попробуй ещё раз.";
  } finally {
    ui.remindBusy = false;
    if (ui.screen === "home") render();
  }
}

function startSession() {
  ui.drill = {
    session: {
      tasks: sessionPlan(data.state),
      cursor: 0,
      startedAt: Date.now(),
      before: structuredClone(normalizeState(data.state)),
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

function beginProblem(mode, options = {}) {
  const level = Number.isInteger(options.level) ? options.level : data.state.levels[mode];
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
    level,
    review: !!options.review,
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
  const review = session?.phase === "review" ? session.review : null;
  const left = session ? Math.max(0, SESSION_MS - (Date.now() - session.startedAt)) : 0;
  const title = review ? "Повторение" : session ? `Занятие · ${clockText(left)}` : MODE_TITLE[drill.mode];
  const sub = review
    ? `${review.index + 1} из ${review.total}`
    : session
      ? `сделано ${session.cursor}`
      : LEVEL_NAMES[drill.mode][drill.level];
  const step = drill.mode === "facts" ? null : drill.problem.steps[drill.step];
  const info = step && step.expect == null;
  return el("div", { class: "page drill-page" },
    el("header", { class: "top" },
      el("button", { class: "text", type: "button", onclick: goHome }, "На главную"),
      el("div", {},
        el("div", { id: session && !review ? "clock" : undefined }, title),
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
  const limit = MODE_META.facts.times[drill.level ?? data.state.levels.facts];
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
  data.queue.push({
    id: crypto.randomUUID(),
    mode: drill.mode,
    ok,
    ms,
    at: new Date().toISOString(),
    detail: detailOf(drill),
  });
  if (drill.review) {
    data.state = recordPractice(data.state, drill.mode, { ok, ms });
    if (drill.session) {
      const slot = drill.session.tally[drill.mode];
      slot.ok += ok ? 1 : 0;
      slot.bad += ok ? 0 : 1;
      if (!ok) drill.session.review.clean = false;
    }
    persist();
    sync();
    advance();
    return;
  }
  const fact = drill.mode === "facts" ? drill.problem.key : null;
  const result = applyResult(data.state, drill.mode, {
    ok,
    ms,
    factKey: fact,
    weakKeys: [...drill.weak],
  });
  data.state = result.state;
  if (drill.session) {
    const slot = drill.session.tally[drill.mode];
    slot.ok += ok ? 1 : 0;
    slot.bad += ok ? 0 : 1;
    if (result.change) drill.session.notes.push(levelNote(drill.mode, result.change, result.level));
    if (result.star) {
      drill.session.notes.push(`Новая звезда на уровне «${LEVEL_NAMES[result.star.mode][result.star.level]}».`);
    }
  }
  persist();
  sync();
  if (result.change || result.star) {
    const parts = [];
    if (result.change) parts.push(levelNote(drill.mode, result.change, result.level));
    if (result.star) parts.push(`Звезда за «${LEVEL_NAMES[result.star.mode][result.star.level]}».`);
    ui.note = {
      text: parts.join(" "),
      reaction: reactionFor({ change: result.change, star: !!result.star }),
    };
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
  if (session.phase === "review") {
    advanceReview();
    return;
  }
  session.cursor += 1;
  const expired = !sessionStillOpen(session.startedAt, Date.now());
  if (!expired) {
    beginProblem(nextSessionMode(session.tasks, session.cursor));
    return;
  }
  const target = reviewTarget(data.state, moscowDay());
  if (target) {
    session.phase = "review";
    session.expired = expired;
    session.review = {
      mode: target.mode,
      level: target.level,
      total: reviewLength(target.mode),
      index: 0,
      clean: true,
    };
    beginProblem(target.mode, { level: target.level, review: true });
    return;
  }
  finishSession(expired);
}

function advanceReview() {
  const review = ui.drill.session.review;
  if (!review.clean || review.index + 1 >= review.total) {
    closeReview();
    return;
  }
  review.index += 1;
  beginProblem(review.mode, { level: review.level, review: true });
}

function closeReview() {
  const session = ui.drill.session;
  const review = session.review;
  const day = moscowDay();
  const name = LEVEL_NAMES[review.mode][review.level];
  if (review.clean) {
    const result = grantNextStar(data.state, review.mode, review.level, day);
    data.state = result.state;
    if (result.gained) {
      session.notes.push(`Новая звезда на уровне «${name}».`);
      persist();
      sync();
      ui.note = {
        text: `Новая звезда на уровне «${name}».`,
        reaction: reactionFor({ star: true }),
        after: () => finishSession(!!session.expired),
      };
      ui.screen = "note";
      render();
      return;
    }
  } else {
    data.state = touchStarDate(data.state, review.mode, review.level, day);
    session.notes.push(`Проверка «${name}» в этот раз без звезды. Можно снова через 3 дня.`);
  }
  persist();
  sync();
  finishSession(!!session.expired);
}

function finishSession(expired) {
  const session = ui.drill.session;
  ui.summary = {
    tally: session.tally,
    notes: session.notes.slice(),
    expired,
    before: session.before,
    after: data.state,
  };
  ui.drill = null;
  ui.note = null;
  ui.screen = "summary";
  render();
}

function noteScreen() {
  return el("div", { class: "page" },
    el("main", { class: "note" },
      mascotImg(currentStickers().at(-1), "mascot"),
      el("h1", {}, "Уровень"),
      el("p", { class: "lead" }, ui.note.text),
      ui.note.reaction ? el("p", { class: "quiet" }, ui.note.reaction) : null,
      el("button", { class: "primary", type: "button", onclick: () => {
        const after = ui.note?.after;
        if (after) after();
        else advance();
      } }, "Далее"),
    ),
  );
}

function summaryScreen() {
  const { tally, notes, expired, before, after } = ui.summary;
  const rows = MODES.map((mode) => {
    const slot = tally[mode];
    const total = slot.ok + slot.bad;
    if (!total) return null;
    return el("div", { class: "stat" },
      el("span", {}, MODE_TITLE[mode]),
      el("b", {}, `${total} ${examplesWord(total)}, ${slot.ok} верно`));
  });
  const events = before && after ? contributionLines(before, after) : [];
  const steps = events.length ? practicedProgress(before, after, tally) : [];
  return el("div", { class: "page" },
    el("main", { class: "summary" },
      mascotImg(currentStickers().at(-1), "mascot"),
      el("h1", {}, "Занятие готово"),
      el("p", { class: "lead" }, expired
        ? "Семь минут прошли. Этого достаточно на сегодня."
        : "Все примеры из занятия сделаны."),
      el("p", { class: "quiet" }, reactionFor()),
      ...rows,
      ...events.map((text) => el("p", {}, text)),
      ...steps.map((text) => el("p", { class: "quiet" }, text)),
      ...notes.filter((text) => !events.includes(text)).map((text) => el("p", { class: "quiet" }, text)),
      el("button", { class: "primary", type: "button", onclick: goHome, style: "margin-top:18px" }, "На главную"),
    ),
  );
}

function practicedProgress(before, after, tally) {
  const lines = [];
  for (const mode of MODES) {
    const slot = tally[mode];
    if (!slot || slot.ok + slot.bad === 0) continue;
    if (before.levels[mode] !== after.levels[mode]) continue;
    let starred = false;
    for (let level = 0; level <= MODE_META[mode].max; level += 1) {
      if ((after.stars[mode][level]?.n || 0) > (before.stars[mode][level]?.n || 0)) starred = true;
    }
    if (starred) continue;
    if (windowProgress(mode, after.levels[mode], after.recent[mode]).have === 0) continue;
    lines.push(progressLine(mode, after));
  }
  return lines;
}

function stickersScreen() {
  const total = starTotal(data.state);
  const solved = practiceCount(data.state);
  return el("div", { class: "page" },
    el("header", { class: "top" },
      el("button", { class: "text", type: "button", onclick: goHome }, "На главную"),
      el("p", { class: "quiet" }, `${total} из ${starCap()}`),
    ),
    el("main", {},
      el("h1", {}, "Наклейки"),
      el("p", { class: "quiet" }, "Первая наклейка за первое задание. Дальше новая за каждые 3 звезды."),
      el("div", { class: "stickers" }, STICKERS.map((item, index) => {
        const open = stickerUnlocked(index, total, solved);
        return el("figure", { class: open ? "sticker" : "sticker locked" },
          open ? mascotImg(item, "sticker-img") : el("img", { class: "sticker-img", src: FALLBACK, alt: "" }),
          el("figcaption", {}, open ? item.title : stickerLockText(index)),
        );
      })),
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
