import { getStore } from "@netlify/blobs";
import { timingSafeEqual, randomUUID } from "node:crypto";

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function okKey(k) {
  const e = process.env.EDIT_KEY || "";
  if (!e || typeof k !== "string") return false;
  const a = Buffer.from(k), b = Buffer.from(e);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== "POST") return J({ error: "method not allowed" }, 405);
  if (!okKey(req.headers.get("x-edit-key"))) return J({ error: "only editors can upload" }, 403);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 5 * 1024 * 1024) return J({ error: "PDF is over 5 MB" }, 413);
  if (buf.byteLength < 5 || new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") return J({ error: "only PDF files" }, 400);
  let name = "file.pdf";
  try { name = decodeURIComponent(req.headers.get("x-filename") || name); } catch {}
  name = name.replace(/[^\w.\- ()]/g, "_").slice(0, 80);
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  await getStore("cysec-files").set(id, buf, { metadata: { name } });
  return J({ ok: true, file: { id, name } });
};

export const config = { path: "/api/upload" };
