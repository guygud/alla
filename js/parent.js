import { parentReport } from "./api.js";
import { renderKeypad } from "./keypad.js";
import { LEVEL_NAMES, MODE_TITLE, normalizeState } from "./levels.js";
import { el } from "./ui.js";

const NB = "\u00A0";
const NAME_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё -]{0,22}[A-Za-zА-Яа-яЁё]$/;
const ERRORS = {
  bad_pin: "Код не подошёл. Проверь цифры и попробуй ещё раз.",
  locked: "Слишком много попыток. Подожди минуту.",
  bad_name: "Имя нужно из букв, от 2 до 24.",
  not_found: "Такого имени ещё нет. Сначала открой тренажёр и задай код.",
};

let login = { name: "", pin: "", error: "", busy: false, phase: "name" };
let report = null;

function render() {
  const root = document.getElementById("app");
  root.replaceChildren(report ? reportScreen() : loginScreen());
}

function loginScreen() {
  const pinPhase = login.phase === "pin";
  return el("div", { class: "page" },
    el("header", { class: "top" },
      el("a", { class: "linkish", href: "./" }, "К тренажёру"),
    ),
    el("main", {},
      el("h1", {}, "Для родителей"),
      el("p", { class: "lead" }, pinPhase
        ? "Тот же код, что и в тренажёре."
        : "Имя ребёнка и код из 4 цифр."),
      pinPhase
        ? el("div", { class: "dots" }, [0, 1, 2, 3].map((i) => el("i", { class: `dot${i < login.pin.length ? " fill" : ""}` })))
        : el("input", {
          class: "field",
          id: "name",
          value: login.name,
          maxlength: "24",
          autocomplete: "name",
          placeholder: "Имя",
        }),
      el("p", { class: "error" }, login.error),
      pinPhase
        ? el("button", { class: "text", type: "button", onclick: () => { login.phase = "name"; login.pin = ""; login.error = ""; render(); } }, "Назад")
        : el("button", { class: "primary", type: "button", disabled: login.busy, onclick: onName }, "Далее"),
    ),
    pinPhase ? renderKeypad({
      disabled: login.busy,
      okLabel: "Открыть",
      onDigit: (digit) => {
        if (login.pin.length >= 4 || login.busy) return;
        login.pin += digit;
        login.error = "";
        render();
        if (login.pin.length === 4) submit();
      },
      onBack: () => { login.pin = login.pin.slice(0, -1); render(); },
      onOk: submit,
    }) : null,
  );
}

function onName() {
  const name = (document.getElementById("name")?.value || "").trim();
  if (!NAME_RE.test(name)) {
    login.name = name;
    login.error = "Напиши имя буквами, хотя бы две.";
    render();
    return;
  }
  login.name = name;
  login.phase = "pin";
  login.pin = "";
  login.error = "";
  render();
}

async function submit() {
  if (login.busy || login.pin.length !== 4) return;
  login.busy = true;
  login.error = "";
  render();
  try {
    const res = await parentReport(login.name, login.pin);
    login.busy = false;
    if (!res?.ok) {
      login.pin = "";
      login.error = ERRORS[res?.error] || "Не получилось открыть статистику.";
      render();
      return;
    }
    report = res;
    render();
  } catch {
    login.busy = false;
    login.pin = "";
    login.error = "Нет связи с базой. Проверь интернет и попробуй ещё раз.";
    render();
  }
}

function reportScreen() {
  const state = normalizeState(report.state);
  const name = report.name;
  return el("div", { class: "page" },
    el("header", { class: "top" },
      el("a", { class: "linkish", href: "./" }, "К тренажёру"),
      el("button", { class: "text", type: "button", onclick: () => { report = null; login.pin = ""; login.phase = "name"; render(); } }, "Выйти"),
    ),
    el("main", {},
      el("h1", {}, name),
      levelsBlock(state),
      accuracyBlock(report.modes || {}),
      el("h2", {}, "Таблица 2–9"),
      el("p", { class: "quiet" }, `Клетка 7${NB}×${NB}8 общая с${NB}8${NB}×${NB}7. Серым отмечено то, чего ещё не было.`),
      heatmap(state.stats || {}),
      weakList(state.stats || {}),
      el("h2", {}, "Последние 14 дней"),
      dayChart(report.days || []),
    ),
  );
}

function levelsBlock(state) {
  return el("div", {},
    ["facts", "column", "division"].map((mode) => el("div", { class: "stat" },
      el("span", {}, MODE_TITLE[mode]),
      el("b", {}, LEVEL_NAMES[mode][state.levels[mode]]))));
}

function accuracyBlock(modes) {
  const order = ["facts", "column", "division"];
  const rows = order.map((mode) => {
    const row = modes[mode];
    if (!row) return null;
    const total = row.ok + row.bad;
    return el("div", { class: "stat" },
      el("span", {}, MODE_TITLE[mode]),
      el("b", {}, `${Math.round((row.ok / total) * 100)}% · ${formatSec(row.med_ms)}`));
  }).filter(Boolean);
  return el("div", {},
    el("h2", {}, "14 дней: точность и время"),
    rows.length ? rows : el("p", { class: "quiet" }, "Пока нет занятий."));
}

function errorsWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "ошибка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ошибки";
  return "ошибок";
}

function formatSec(ms) {
  if (!ms) return "—";
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1).replace(".", ",")} с`;
  return `${Math.round(sec)} с`;
}

function heatmap(stats) {
  const head = [el("b", {}, "")];
  for (let c = 2; c <= 9; c += 1) head.push(el("b", {}, String(c)));
  const rows = [head];
  for (let r = 2; r <= 9; r += 1) {
    const row = [el("b", {}, String(r))];
    for (let c = 2; c <= 9; c += 1) {
      const key = `${Math.min(r, c)}*${Math.max(r, c)}`;
      const stat = stats[key] || { ok: 0, bad: 0 };
      const tone = heatTone(stat.ok, stat.bad);
      const title = stat.ok + stat.bad
        ? `${r} × ${c}: ${stat.ok} верно, ${stat.bad} ${errorsWord(stat.bad)}`
        : `${r} × ${c}: ещё не было`;
      row.push(el("i", { style: `background:${tone.bg};color:${tone.fg}`, title }, stat.ok + stat.bad ? String(stat.bad) : ""));
    }
    rows.push(row);
  }
  return el("div", {},
    el("div", { class: "heat" }, rows),
    el("div", { class: "legend" }, el("span", {}, "меньше ошибок"), el("span", {}, "больше ошибок")),
  );
}

function heatTone(ok, bad) {
  const total = ok + bad;
  if (!total) return { bg: "#e6dfd2", fg: "#8a8175" };
  const badRate = bad / total;
  const hue = Math.round(136 - badRate * 128);
  return { bg: `hsl(${hue} 42% 36%)`, fg: "#fffaf2" };
}

function weakList(stats) {
  const items = Object.entries(stats)
    .filter(([, stat]) => stat.bad > 0)
    .sort((a, b) => b[1].bad - a[1].bad || a[1].ok - b[1].ok)
    .slice(0, 5);
  if (!items.length) return null;
  return el("div", {},
    el("h2", {}, "Чаще ошибается"),
    ...items.map(([key, stat]) => {
      const [a, b] = key.split("*");
      return el("div", { class: "stat" },
        el("span", {}, `${a} × ${b}`),
        el("b", {}, `${stat.bad} ${errorsWord(stat.bad)}`));
    }),
  );
}

function dayChart(days) {
  const labels = lastDays(14);
  const totals = Object.fromEntries(labels.map((day) => [day, 0]));
  for (const row of days) {
    if (row.day in totals) totals[row.day] += row.ok + row.bad;
  }
  const max = Math.max(1, ...Object.values(totals));
  const any = Object.values(totals).some((n) => n > 0);
  if (!any) return el("p", { class: "quiet" }, "За две недели занятий ещё не было.");
  return el("div", { class: "days" }, labels.map((day) => {
    const count = totals[day];
    return el("div", {},
      el("span", { style: `height:${Math.max(4, Math.round((count / max) * 92))}px`, title: `${day}: ${count}` }),
      el("small", {}, weekday(day)));
  }));
}

function lastDays(count) {
  const days = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(now.getTime() - i * 86400000)));
  }
  return days;
}

function weekday(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

const host = location.hostname;
if ("serviceWorker" in navigator && host !== "localhost" && host !== "127.0.0.1") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
render();
