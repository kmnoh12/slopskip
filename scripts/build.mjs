import { mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const entryPoints = {
  "background/index": path.join(root, "src/background/index.ts"),
  "content/index": path.join(root, "src/content/index.ts"),
  "popup/popup": path.join(root, "src/popup/popup.ts"),
  "options/options": path.join(root, "src/options/options.ts")
};

async function copyStatic() {
  await mkdir(path.join(dist, "popup"), { recursive: true });
  await mkdir(path.join(dist, "options"), { recursive: true });
  await mkdir(path.join(dist, "icons"), { recursive: true });
  await cp(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
  await cp(path.join(root, "src/popup/popup.html"), path.join(dist, "popup/popup.html"));
  await cp(path.join(root, "src/popup/popup.css"), path.join(dist, "popup/popup.css"));
  await cp(path.join(root, "src/options/options.html"), path.join(dist, "options/options.html"));
  await cp(path.join(root, "src/options/options.css"), path.join(dist, "options/options.css"));
  await cp(path.join(root, "_locales"), path.join(dist, "_locales"), { recursive: true });
  await cp(path.join(root, "public/icons"), path.join(dist, "icons"), { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const ctx = await esbuild.context({
  entryPoints,
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  platform: "browser",
  logLevel: "info"
});

if (watch) {
  await copyStatic();
  await ctx.watch();
  console.log("Watching SlopSkip...");
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
}
