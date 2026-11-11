// The YouTube Data API calls the script makes, as Google's docs show them, behind
// the path the machine's gateway serves, so the real script runs with no Google.
import { createServer } from "node:http";

/**
 * @param {{ channel?: { id: string, customUrl?: string, title?: string }, pages?: any[][], videos?: Record<string, any>, tracks?: Record<string, any[]>, srt?: Record<string, string>, error?: (path: string) => { status: number, reason: string } | undefined }} data
 */
export async function fakeYouTube(data) {
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace("/api/machine/gateway/youtube", "");
    const q = Object.fromEntries(url.searchParams);
    calls.push({ path, query: q, auth: req.headers.authorization });
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const error = data.error?.(path);
    if (error) return send(error.status, { error: { code: error.status, errors: [{ reason: error.reason }] } });
    if (path === "/youtube/v3/channels") {
      const c = data.channel;
      return send(200, { items: c ? [{ id: c.id, snippet: { customUrl: c.customUrl, title: c.title } }] : [] });
    }
    if (path === "/youtube/v3/playlistItems") {
      const pages = data.pages ?? [[]];
      const at = Number(q.pageToken ?? 0);
      return send(200, { items: pages[at] ?? [], ...(at + 1 < pages.length ? { nextPageToken: String(at + 1) } : {}) });
    }
    if (path === "/youtube/v3/videos") {
      return send(200, { items: q.id.split(",").flatMap((id) => (data.videos?.[id] ? [{ id, ...data.videos[id] }] : [])) });
    }
    if (path === "/youtube/v3/captions") return send(200, { items: data.tracks?.[q.videoId] ?? [] });
    const track = /^\/youtube\/v3\/captions\/(.+)$/.exec(path)?.[1];
    if (track && data.srt?.[track] !== undefined) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(data.srt[track]);
    }
    return send(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** An uploads-playlist item. */
export const upload = (id, published = "2026-10-01T10:00:00Z", title = `Video ${id}`) => ({ snippet: { title }, contentDetails: { videoId: id, videoPublishedAt: published } });
