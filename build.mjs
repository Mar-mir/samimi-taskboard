import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const esc = html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
fs.writeFileSync("src/_site.js", "export const INDEX_HTML = `" + esc + "`;\n");
console.log("site bytes:", html.length);

const pagesIdx = process.argv.indexOf("--pages");
if (pagesIdx !== -1) {
  const workerUrl = (process.argv[pagesIdx + 1] || "").replace(/\/$/, "");
  const out = html.replace('const API_BASE = "";', `const API_BASE = "${workerUrl}";`);
  fs.mkdirSync("site", { recursive: true });
  fs.writeFileSync("site/index.html", out);
  console.log("pages build -> site/index.html, API:", workerUrl || "(empty)");
}
