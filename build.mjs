import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node-pty", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  loader: {
    ".css": "text"
  }
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
} else {
  await esbuild.build(buildOptions);
}
