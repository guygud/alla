import { dayTotals } from "./levels.js";

export const VAPID_PUBLIC_KEY = "BDoYfYeiPWE-SVHa6zm2NOJnMxfUyiU4NlB5tSiT6Wiza57HETYGqt9kgY99UPZV4b9ylIK8LmRp2fpsH-K2Xd8";

export function needsReminder(state, day) {
  return dayTotals(state, day).total === 0;
}

export function vapidKeyBytes(key) {
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
