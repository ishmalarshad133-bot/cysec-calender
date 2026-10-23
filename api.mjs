import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function okKey(k) {
  const e = process.env.EDIT_KEY || "";
  if (!e || typeof k !== "string") return false;
  const a = Buffer.from(k), b = Buffer.from(e);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  const store = getStore("cysec");
  const state = (await store.get("state", { type: "json" })) || { events: {}, polls: [] };
  const votes = (await store.get("votes", { type: "json" })) || {};

  if (req.method === "GET") return J({ ...state, votes });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);

  let b;
  try { b = await req.json(); } catch { return J({ error: "bad request" }, 400); }

  // is this the real edit key?
  if (b.action === "auth") return J({ ok: okKey(b.key) });

  // editors only: save plans + polls
  if (b.action === "save") {
    if (!okKey(b.key)) return J({ error: "wrong edit key" }, 403);
    const events = b.events && typeof b.events === "object" ? b.events : {};
    const polls = Array.isArray(b.polls) ? b.polls.slice(0, 30) : [];
    if (JSON.stringify({ events, polls }).length > 400000) return J({ error: "too big" }, 413);
    await store.setJSON("state", { events, polls });
    const ids = new Set(polls.map((p) => p.id));
    for (const v of Object.values(votes))
      for (const id of Object.keys(v.answers || {})) if (!ids.has(id)) delete v.answers[id];
    await store.setJSON("votes", votes);
    return J({ ok: true });
  }

  // anyone: vote (name + option)
  if (b.action === "vote") {
    const name = String(b.name || "").trim().slice(0, 30);
    const voter = String(b.voter || "");
    const poll = state.polls.find((p) => p.id === b.pollId);
    if (!name || voter.length < 8 || voter.length > 80) return J({ error: "name needed" }, 400);
    if (!poll || !poll.opts.includes(b.option)) return J({ error: "bad option" }, 400);
    if (!votes[voter] && Object.keys(votes).length > 2000) return J({ error: "too many voters" }, 429);
    votes[voter] = { name, answers: { ...(votes[voter]?.answers || {}), [poll.id]: b.option } };
    await store.setJSON("votes", votes);
    return J({ ok: true });
  }

  return J({ error: "unknown action" }, 400);
};

export const config = { path: "/api" };
