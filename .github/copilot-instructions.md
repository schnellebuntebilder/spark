# Copilot Instructions – spark

## Project Overview

`@sparkjsdev/spark` is a 3D Gaussian Splat renderer built on Three.js with a Rust/WASM core (`src/`). The `examples/` directory contains standalone HTML demos served via Docker.

---

## Critical: dist/ is pre-committed WASM

- `dist/spark.module.js` embeds compiled Rust/WASM — **never edit manually**
- Building requires Rust toolchain + wasm-pack: `npm run build:wasm && npm run build`
- The Dockerfile runs `npm ci --ignore-scripts` — it does **not** rebuild WASM
- TypeScript changes to `src/` have **no runtime effect** without a full WASM rebuild

---

## Prompt Conventions

- If a user prompt **starts with `TEST`**: only implement the changes — **do NOT commit** and **do NOT build** (no `docker compose build`, no `npm run build`).

---

## Workflow: Docker → Check → Commit

Before every commit:

1. **Rebuild Docker image (via Compose!):** `docker compose build`
   - ⚠️ Do NOT use `docker build -t spark-examples .` — that builds a separate image that Compose does NOT use
   - ⚠️ Do NOT use `--no-cache` — the Dockerfile is structured so heavy layers (apt, npm, asset download) are cached; only `COPY . .` + mkdocs rebuild on each run (~30s). Use `--no-cache` only if you need a truly clean state.
2. **Force-recreate container:** `docker compose up -d --force-recreate`
3. **Verify the site** at `https://spark.schnellebunte.cloud/examples/#teleport` — check for console errors
4. **Then commit**

---

## Examples Structure

```
examples/
  js/                   # Shared modules used across examples
    controller_quest.js # Quest/WebXR gamepad controller
    controller_touch.js # Touch controller (pinch + double-tap)
    controller_web.js   # Keyboard/mouse controller
    frustum.js          # CPU frustum culling via dynoBlock
    gui.js              # lil-gui settings panel
    hud.js              # On-screen HUD (splat count, FPS)
    preloader.js        # Asset preloading
  teleport/             # Main development example
    index.html
  nonlod/               # Reference example for SparkRenderer + LoD
  ...
```

---

## dyno API Conventions

The `dyno` namespace provides a GPU compute graph system.

| Style | Usage |
|---|---|
| PascalCase | Constructor classes: `DynoMat4`, `DynoBool`, `DynoFloat`, `Gsplat` |
| camelCase | Factory functions: `dynoBlock`, `dynoConst`, `splitGsplat`, `combineGsplat`, `extendVec` |
| camelCase | Math ops: `mul`, `div`, `neg`, `or`, `select`, `swizzle`, `lessThan`, `greaterThan` |

All are exported from the `dyno` namespace object in `dist/spark.module.js`.

### Key type rules
- `dynoBool(false)` — positional arg, NOT `dynoBool({ value: false })`
- `splitGsplat(gsplat).outputs.flags` → type `"uint"`, `.center` → type `"vec3"`
- `extendVec(vec3, float)` → `"vec4"`
- `mul(mat4, vec4)` → `"vec4"`
- `swizzle(vec4, "x")` → `"float"` (single char → scalar)
- `select(cond, t, f)` → `(cond) ? t : f`
- `combineGsplat({ gsplat, flags: newFlags })` — unspecified fields fall back to gsplat fields

### lil-gui safety rule
`gui.add(obj, "prop")` crashes if `obj.prop === undefined`. Always use a proxy object with a default value or guard with `if (obj)`.

---

## Frustum Culling (examples/js/frustum.js)

- `createFrustumCulling()` returns `{ settings, makeFrustumCullModifier, updateFrustumUniforms, setSortClipXY }`
- `makeFrustumCullModifier()` — dynoBlock: projects splat center via VP matrix, sets `flags=0` if outside `sortClipXY` NDC bounds
- `updateFrustumUniforms(camera)` — call **after** all controller updates and `localFrame.updateMatrixWorld(true)` so the current-frame camera position is used
- `spark.clipXY` — GPU-side NDC clip (default 1.1); `sortClipXY` — CPU-side cull bound (default 2.0)

---

## Service → Container Mapping (cAdvisor / Loki)

- **cAdvisor** metric label `name`: no leading slash — e.g. `spark`
- **Loki** log label `container`: has leading slash — e.g. `/spark`
- Use `$log_container` in Loki queries, `$container` in Prometheus/cAdvisor queries

---

## Available npm Scripts

| Command | Purpose |
|---|---|
| `npm run build` | Build JS (no WASM) |
| `npm run build:wasm` | Build Rust/WASM (needs Rust toolchain) |
| `npm run lint` | Run Biome linter |
| `npm run format` | Check formatting |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format:fix` | Auto-fix formatting |
| `npm test` | Run tests |
| `npm run dev` | Dev server (Vite) |
