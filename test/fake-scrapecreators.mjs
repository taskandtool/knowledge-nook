// ScrapeCreators' three YouTube endpoints as their docs show them, behind the
// path the machine's gateway serves, so the real script runs with no vendor,
// no credits and no YouTube.
import { createServer } from "node:http";

/**
 * @param {{ pages: Record<string, any[][]>, videos?: Record<string, any>, transcripts?: Record<string, any[] | null>, status?: (path: string, nth: number) => number | undefined, refuse?: string }} data
 */
export async function fakeVendor(data) {
  const calls = [];
  /** @type {any} */
  const fake = { calls };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace("/api/machine/gateway/scrapecreators", "");
    calls.push({ path, query: Object.fromEntries(url.searchParams), key: req.headers["x-api-key"] });
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (fake.refuseOnce) {
      const { status, refusal } = fake.refuseOnce;
      fake.refuseOnce = null;
      return send(status, { error: refusal }, { "x-tasktool-refusal": refusal });
    }
    if (fake.failFor && url.searchParams.get("handle") === fake.failFor) return send(404, { error: "no channel" });
    if (data.refuse) return send(403, { error: "refused" }, { "x-tasktool-refusal": data.refuse });
    const status = data.status?.(path, calls.filter((c) => c.path === path).length);
    if (status) return send(status, { error: `status ${status}` });
    const videoId = new URL(url.searchParams.get("url") ?? "http://x").searchParams.get("v");
    if (path === "/v1/youtube/channel-videos") {
      const pages = data.pages[url.searchParams.get("handle") ?? url.searchParams.get("channelId")] ?? [[]];
      const at = Number(url.searchParams.get("continuationToken") ?? 0);
      return send(200, { success: true, credits_charged: 1, videos: pages[at], ...(at + 1 < pages.length ? { continuationToken: String(at + 1) } : {}) });
    }
    if (path === "/v1/youtube/video") {
      return data.videos?.[videoId] ? send(200, { success: true, credits_charged: 1, id: videoId, ...data.videos[videoId] }) : send(404, { error: "no video" });
    }
    if (path === "/v1/youtube/video/transcript") {
      const transcript = data.transcripts?.[videoId] ?? null;
      return send(200, { success: true, credits_charged: transcript ? 1 : 0, videoId, transcript, language: "English" });
    }
    return send(404, { error: "no route" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // A failed assertion skips close(); the suite must still end and report it.
  server.unref();
  return Object.assign(fake, { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
}
