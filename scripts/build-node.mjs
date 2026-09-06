/**
 * Bundles the entrypoints that run outside Next: the queue worker and the
 * migrator.
 *
 * Both are TypeScript with `@/` path aliases, so production would otherwise
 * need `tsx` and the whole TypeScript toolchain installed just to boot. Every
 * runtime dependency stays external and is resolved from `node_modules`,
 * because `sharp` and `pg` ship native code that cannot be bundled.
 */
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const external = [
  ...Object.keys(manifest.dependencies ?? {}),
  // Optional peer of pg that it only requires when present.
  "pg-native"
];

await build({
  entryPoints: {
    worker: path.join(root, "src/worker/main.ts"),
    migrate: path.join(root, "scripts/migrate.ts")
  },
  outdir: path.join(root, "dist"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // The package is CommonJS, so ESM output needs the extension to say so.
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  // ESM output plus CommonJS dependencies needs `require` defined.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);"
    ].join("\n")
  },
  external,
  alias: { "@": path.join(root, "src") },
  logLevel: "info"
});
