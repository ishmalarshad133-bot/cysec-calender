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

const MAX_FILE = 5 * 1024 * 1024;

export default async (req) => {
  const url = new URL(req.url);

  // download a file (anyone)
  if (req.method === "GET" && url.searchParams.get("file")) {
    const id = url.searchParams.get("file");
    if (!/^[a-z0-9-]{8,60}$/i.test(id)) return J({ error: "bad id" }, 400);
    const f = await getStore("cysec-files").getWithMetadata(id, { type: "arrayBuffer" });
    if (!f) return J({ error: "not found" }, 404);
    const name = String(f.metadata?.name || "file").replace(/[^\w.\- ]/g, "_");
    return new Response(f.data, {
      headers: {
        "content-type": f.metadata?.type || "application/octet-stream",
        "content-disposition": `attachment; filename="${name}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    });
  }

  // upload a file (editors only)
  if (req.method === "POST" && url.searchParams.get("upload")) {
    if (!okKey(req.headers.get("x-edit-key"))) return J({ error: "wrong edit key" }, 403);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return J({ error: "empty file" }, 400);
    if (buf.byteLength > MAX_FILE) return J({ error: "file too big (max 5 MB)" }, 413);
    const id = crypto.randomUUID();
    const name = (url.searchParams.get("name") || "file").slice(0, 100);
    const type = req.headers.get("content-type") || "application/octet-stream";
    await getStore("cysec-files").set(id, buf, { metadata: { name, type } });
    return J({ ok: true, id, name, size: buf.byteLength });
  }

  const store = getStore("cysec");
  const state = (await store.get("state", { type: "json" })) || { events: {}, polls: [], resources: [] };
  const votes = (await store.get("votes", { type: "json" })) || {};

  if (req.method === "GET") return J({ ...state, votes });
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);

  let b;
  try { b = await req.json(); } catch { return J({ error: "bad request" }, 400); }

  if (b.action === "auth") return J({ ok: okKey(b.key) });

  if (b.action === "save") {
    if (!okKey(b.key)) return J({ error: "wrong edit key" }, 403);
    const events = b.events && typeof b.events === "object" ? b.events : {};
    const polls = Array.isArray(b.polls) ? b.polls.slice(0, 30) : [];
    const resources = (Array.isArray(b.resources) ? b.resources : []).slice(0, 100).map((r) => ({
      label: String(r?.label || "").slice(0, 120),
      url: String(r?.url || "").slice(0, 1000),
      fileId: String(r?.fileId || "").slice(0, 60),
      fileName: String(r?.fileName || "").slice(0, 100),
    }));
    if (JSON.stringify({ events, polls, resources }).length > 400000) return J({ error: "too big" }, 413);
    await store.setJSON("state", { events, polls, resources });
    const ids = new Set(polls.map((p) => p.id));
    for (const v of Object.values(votes))
      for (const id of Object.keys(v.answers || {})) if (!ids.has(id)) delete v.answers[id];
    await store.setJSON("votes", votes);
    return J({ ok: true });
  }

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
