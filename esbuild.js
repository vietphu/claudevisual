const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");
// Production mode: minified, no source maps — used by `vscode:prepublish` /
// `npm run package` ahead of `vsce package`. Dev mode (default) keeps
// sourcemaps and skips minification for readable stack traces + fast rebuilds.
const production =
  process.argv.includes("--production") || process.env.NODE_ENV === "production";

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/ui/webview-ui/main.ts"],
  bundle: true,
  outfile: "dist/webview/main.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: !production,
  minify: production,
};

/**
 * Second browser-target bundle: the sidebar WebviewView client (distinct from
 * the dashboard panel above). Output lives in its own `dist/webview-view/`
 * folder so each view's `localResourceRoots` can be scoped to just its assets.
 */
/** @type {import('esbuild').BuildOptions} */
const sidebarViewConfig = {
  entryPoints: ["src/ui/webview-view-ui/main.ts"],
  bundle: true,
  outfile: "dist/webview-view/main.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: !production,
  minify: production,
};

/**
 * Copies `src/hooks/hook-scripts/*` into `dist/hook-scripts/` unmodified.
 * These run standalone via `node`/`bash` once installed into the user's
 * `~/.claude/settings.json` — they are never imported by, or bundled into,
 * `dist/extension.js`, so esbuild's bundler must not touch them.
 */
function copyHookScripts() {
  const srcDir = path.join(__dirname, "src", "hooks", "hook-scripts");
  const destDir = path.join(__dirname, "dist", "hook-scripts");
  if (!fs.existsSync(srcDir)) {
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    fs.copyFileSync(srcPath, destPath);
    // fs.copyFileSync resets permissions to the destination default, which
    // is not executable — restore it for the shell shim so `bash "<path>"`
    // (which doesn't require the exec bit) and any direct invocation both work.
    if (entry.endsWith(".sh")) {
      fs.chmodSync(destPath, 0o755);
    }
  }
  console.log(`copied ${entries.length} hook-script file(s) to dist/hook-scripts`);
}

/**
 * Copies `src/ui/webview-ui/dashboard.css` to `dist/webview/dashboard.css`
 * unmodified. Plain CSS, not referenced by any `import` in the webview-ui
 * TS sources (deliberately — no CSS-in-JS/bundler-loader dependency), so
 * esbuild's bundler never sees it; `panel.ts` links to it directly via a
 * `<link>` tag built from this same `dist/webview/` output path.
 */
function copyDashboardCss() {
  const srcPath = path.join(__dirname, "src", "ui", "webview-ui", "dashboard.css");
  const destDir = path.join(__dirname, "dist", "webview");
  if (!fs.existsSync(srcPath)) {
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, path.join(destDir, "dashboard.css"));
  console.log("copied dashboard.css to dist/webview");
}

/**
 * Copies the sidebar WebviewView stylesheet to `dist/webview-view/sidebar.css`
 * unmodified — same rationale as {@link copyDashboardCss}: plain CSS linked via
 * a `<link>` tag, never imported by the TS sources, so esbuild never sees it.
 */
function copySidebarCss() {
  const srcPath = path.join(__dirname, "src", "ui", "webview-view-ui", "sidebar.css");
  const destDir = path.join(__dirname, "dist", "webview-view");
  if (!fs.existsSync(srcPath)) {
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, path.join(destDir, "sidebar.css"));
  console.log("copied sidebar.css to dist/webview-view");
}

async function run() {
  copyHookScripts();
  copyDashboardCss();
  copySidebarCss();
  const configs = [extensionConfig, webviewConfig, sidebarViewConfig];
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("esbuild watching...");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log(`esbuild build complete${production ? " (production)" : ""}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
