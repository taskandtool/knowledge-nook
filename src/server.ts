// The machine's dev server: the static files, then the app. `npm run dev` runs this.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const staticDir = relative(process.cwd(), fileURLToPath(new URL("../static", import.meta.url))) || ".";

const server = new Hono();
const fresh = (_path: string, c: any) => c.header("Cache-Control", "no-cache");
// Search comes from the last build's index.
server.use("/pagefind/*", serveStatic({ root: "./dist", onFound: fresh }));
server.use("/og/*", serveStatic({ root: "./dist", onFound: fresh }));
server.use("/*", serveStatic({ root: staticDir, onFound: fresh }));
server.route("/", makeApp());

serve({ fetch: server.fetch, port, hostname: "0.0.0.0" }, (info) => console.log(`knowledge-nook listening on http://localhost:${info.port}`));
