1:21:29 PM: Failed during stage 'building site': Build script returned non-zero exit code: 2 (https://ntl.fyi/exit-code-2)
1:21:28 PM: Netlify Build                                                 
1:21:28 PM: ────────────────────────────────────────────────────────────────
1:21:28 PM: ​
1:21:28 PM: ❯ Version
1:21:28 PM:   @netlify/build 35.13.4
1:21:28 PM: ​
1:21:28 PM: ❯ Flags
1:21:28 PM:   accountId: 69de322c4a84e12ac76b4239
1:21:28 PM:   baseRelDir: true
1:21:28 PM:   buildId: 69f8d5911a0b7cc627aee7bb
1:21:28 PM:   deployId: 69f8d5911a0b7cc627aee7bd
1:21:28 PM: ​
1:21:28 PM: ❯ Current directory
1:21:28 PM:   /opt/build/repo/bsbd-portal 3
1:21:28 PM: ​
1:21:28 PM: ❯ Config file
1:21:28 PM:   /opt/build/repo/bsbd-portal 3/netlify.toml
1:21:28 PM: ​
1:21:28 PM: ❯ Context
1:21:28 PM:   production
1:21:28 PM: ​
1:21:28 PM: build.command from netlify.toml                               
1:21:28 PM: ────────────────────────────────────────────────────────────────
1:21:28 PM: ​
1:21:28 PM: $ npm run build
1:21:28 PM: > bsbd-portal@2.0.0 build
1:21:28 PM: > vite build
1:21:28 PM: vite v5.4.21 building for production...
1:21:28 PM: transforming...
1:21:28 PM: [plugin:vite:esbuild] [plugin vite:esbuild] src/App.jsx: Duplicate key "border" in object literal
1:21:28 PM: 535|              {Object.entries(TAB_LABELS).map(([k, l]) => (
1:21:28 PM: 536|                <button key={k} onClick={() => setTab(k)}
1:21:28 PM: 537|                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tab === k ? '#0d9488' : 'white', color: tab === k ? 'white' : '#64748b', border: tab === k ? 'none' : '1px solid #e2e8f0' }}>
1:21:28 PM:    |                                                                                                                                                                                                                        ^
1:21:28 PM: 538|                  {l}
1:21:28 PM: 539|                </button>
1:21:28 PM: 
1:21:28 PM: ✓ 16 modules transformed.
1:21:28 PM: x Build failed in 126ms
1:21:28 PM: error during build:
1:21:28 PM: Could not resolve "../../components/icons" from "src/App.jsx"
1:21:28 PM: file: /opt/build/repo/bsbd-portal 3/src/App.jsx
1:21:28 PM:     at getRollupError (file:///opt/build/repo/bsbd-portal%203/node_modules/rollup/dist/es/shared/parseAst.js:406:41)
1:21:28 PM:     at error (file:///opt/build/repo/bsbd-portal%203/node_modules/rollup/dist/es/shared/parseAst.js:402:42)
1:21:28 PM:     at ModuleLoader.handleInvalidResolvedId (file:///opt/build/repo/bsbd-portal%203/node_modules/rollup/dist/es/shared/node-entry.js:22120:24)
1:21:28 PM:     at file:///opt/build/repo/bsbd-portal%203/node_modules/rollup/dist/es/shared/node-entry.js:22080:26
1:21:28 PM: ​
1:21:28 PM: "build.command" failed                                        
1:21:28 PM: ────────────────────────────────────────────────────────────────
1:21:28 PM: ​
1:21:28 PM:   Error message
1:21:28 PM:   Command failed with exit code 1: npm run build (https://ntl.fyi/exit-code-1)
1:21:28 PM: ​
1:21:28 PM:   Error location
1:21:28 PM:   In build.command from netlify.toml:
1:21:28 PM:   npm run build
1:21:28 PM: ​
1:21:28 PM:   Resolved config
1:21:28 PM:   build:
1:21:28 PM:     base: /opt/build/repo/bsbd-portal 3
1:21:28 PM:     command: npm run build
1:21:28 PM:     commandOrigin: config
1:21:28 PM:     publish: /opt/build/repo/bsbd-portal 3/dist
1:21:28 PM:     publishOrigin: config
1:21:28 PM:   redirects:
1:21:29 PM:     - from: /*
      status: 200
      to: /index.html
  redirectsOrigin: config
1:21:29 PM: Build failed due to a user error: Build script returned non-zero exit code: 2
1:21:29 PM: Failing build: Failed to build site
1:21:29 PM: Finished processing build request in 7.496s
