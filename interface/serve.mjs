import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "site");
const port = Number(process.env.PORT || 4186);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
  ".zip": "application/zip",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".png": "image/png",
};
http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://127.0.0.1").pathname
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, "." + pathname);
    const permitted =
      file.startsWith(root + path.sep) &&
      !pathname.split("/").some((x) => x.startsWith("."));
    const isFile =
      permitted && fs.existsSync(file) && fs.statSync(file).isFile();
    const route =
      ["/", "/packets", "/board", "/stats", "/docs"].includes(pathname) ||
      /^\/p\/[1-9]\d*$/.test(pathname);
    const target = isFile
      ? file
      : path.join(root, route ? "index.html" : "404.html");
    res.writeHead(isFile || route ? 200 : 404, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    fs.createReadStream(target).pipe(res);
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Parley design preview: http://127.0.0.1:${port}`)
  );
