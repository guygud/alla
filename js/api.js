const URL = "https://bamcbftomojefzxzwdmn.supabase.co";
const KEY = "sb_publishable_W52YtYK6LCNsG6xzD021UQ_jEF7zMI6";

async function rpc(name, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export function loginProfile(name, pin) {
  return rpc("mt_login", { p_name: name, p_pin: pin });
}

export function saveProgress(name, pin, state, attempts) {
  return rpc("mt_save", {
    p_name: name,
    p_pin: pin,
    p_state: state,
    p_updated_at: state.updatedAt,
    p_attempts: attempts,
  });
}

export function parentReport(name, pin) {
  return rpc("mt_parent", { p_name: name, p_pin: pin });
}
