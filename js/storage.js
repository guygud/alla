import { emptyState, normalizeState } from "./levels.js";

const KEY = "alla-trainer-v1";

export function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    return {
      profile: raw.profile || null,
      state: normalizeState(raw.state),
      queue: Array.isArray(raw.queue) ? raw.queue : [],
    };
  } catch {
    return null;
  }
}

export function saveLocal(data) {
  localStorage.setItem(KEY, JSON.stringify({
    profile: data.profile,
    state: data.state,
    queue: data.queue,
  }));
}

export function freshData() {
  return { profile: null, state: emptyState(), queue: [] };
}
