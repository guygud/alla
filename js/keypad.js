import { el } from "./ui.js";

export function renderKeypad({ onDigit, onBack, onOk, okLabel = "Готово", digits = true, disabled = false }) {
  if (!digits) {
    return el("div", { class: "keypad one" },
      el("button", { class: "key ok", type: "button", disabled, onclick: onOk }, okLabel));
  }
  const labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", okLabel];
  return el("div", { class: "keypad" }, labels.map((label) => {
    const ok = label === okLabel;
    const back = label === "⌫";
    return el("button", {
      class: `key${ok ? " ok" : ""}${back ? " back" : ""}`,
      type: "button",
      disabled,
      onclick: () => {
        if (disabled) return;
        if (back) onBack();
        else if (ok) onOk();
        else onDigit(label);
      },
    }, label);
  }));
}
