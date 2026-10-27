import { getStore } from "@netlify/blobs";

export default async (req) => {
  const u = new URL(req.url);
  const id = u.pathname.split("/")[2] || "";
  const dl = u.searchParams.has("dl");
  if (!/^[a-f0-9]{16}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = await getStore("cysec-files").getWithMetadata(id, { type: "arrayBuffer" });
  if (!r) return new Response("Not found", { status: 404 });
  const name = r.metadata?.name || "file.pdf";
  return new Response(r.data, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${dl ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=3600",
    },
  });
};

export const config = { path: "/f/*" };
