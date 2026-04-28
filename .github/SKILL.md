# Spark – Codebase Skill Reference

> Quick-reference for AI agents and contributors to understand the project at a glance.

---

## What is Spark?

`@sparkjsdev/spark` is a **3D Gaussian Splat (3DGS) renderer for Three.js and WebGL2**.  
It lets any Three.js app render photorealistic Gaussian splat scenes alongside normal meshes in a single `renderer.render(scene, camera)` call, on desktop, mobile and WebXR.

Key differentiators:
- Multiple splat objects with **correct mutual sorting** (back-to-front Painter's algorithm)
- Runs on **98 %+ WebGL2** devices (no WebGPU required)
- **Programmable splat pipeline** via the `dyno` GPU shader-graph system
- Level-of-Detail (**LoD**) trees for huge composite worlds, streamed via `.RAD` files
- Real-time editing: color, displacement, skeletal animation, covariance splats

---

## Repository Layout

```
src/              TypeScript source (compiled to dist/ via Vite + wasm-pack)
  dyno/           GPU shader-graph system (DynoVal, Dyno, DynoBlock, …)
  generators/     Procedural splat generators (snowBox, staticBox, …)
  modifiers/      Splat modifier helpers
  shaders/        GLSL vertex + fragment shaders
  SparkRenderer.ts  Top-level renderer
  SplatMesh.ts    High-level splat object
  SplatGenerator.ts Base class for programmatic splat sources
  PackedSplats.ts 16 bytes/splat compact container
  ExtSplats.ts    32 bytes/splat high-precision container
  SplatEdit.ts    SDF-based RGBA/XYZ edit operations
  SplatSkinning.ts Dual-quaternion skeletal animation
  SplatPager.ts   Shared GPU splat page table (LRU)
  SplatLoader.ts  THREE.Loader-compatible file loader
  controls.ts     FpsMovement + PointerControls
  generators.ts   Particle effects (snowBox, staticBox, …)
  splatConstructors.ts  constructGrid, constructAxes, textSplats, imageSplats
rust/             Rust/WASM core + build-lod CLI tool
dist/             Pre-built output – DO NOT edit manually
  spark.module.js Compiled JS+WASM bundle
examples/         Standalone HTML demos (served via Docker)
  js/             Shared modules: controller_*.js, frustum.js, gui.js, hud.js
  teleport/       Main development example
docs/docs/        MkDocs documentation (Markdown)
scripts/          Build / tooling helpers
```

---

## Core Classes

### `SparkRenderer`
Manages the entire splat rendering pipeline. Add exactly one to the scene root.

```ts
const spark = new SparkRenderer({ renderer: webGlRenderer });
scene.add(spark);
```

- Traverses scene graph, collects all `SplatGenerator`/`SplatMesh` instances
- Runs GPU generation pass (`PackedSplats.generate`) each frame
- Reads back sort-distance metric via `Readback`, sorts in a background `SplatWorker`
- Issues a **single instanced draw call** for all splats in the scene
- Key params: `maxStdDev`, `sortRadial`, `enableLod`, `lodSplatScale`, `lodSplatCount`, `clipXY`, `pagedExtSplats`, `covSplats`

### `SplatMesh` ← `SplatGenerator` ← `THREE.Object3D`
High-level splat object, analogous to `THREE.Mesh`.

```ts
const mesh = new SplatMesh({ url: "./scene.spz" });
scene.add(mesh);
```

Sources: `url`, `fileBytes`, `stream`, `packedSplats`, `constructSplats`  
Supported formats: `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`, `.zip`, `.rad`  
Key props: `recolor`, `opacity`, `packedSplats`, `objectModifiers`, `worldModifiers`, `skinning`, `edits`, `maxSh`  
Key params: `lod`, `paged`, `extSplats`, `lodScale`, `onFrame`

### `PackedSplats`
16 bytes/splat compact container (float16 center, uint8 log-scale, uint8 RGBA, axis+angle quat).  
Used for all in-memory and GPU operations. LoD tree lives inside via `.lodSplats`.

### `ExtSplats`
32 bytes/splat high-precision container (float32 center). Use when scene coordinates are large (> ~100 units from origin) to avoid float16 striping artifacts. Enable with `extSplats: true` on `SplatMesh` or `pagedExtSplats: true` on `SparkRenderer`.

### `SplatEdit` + `SplatEditSdf`
SDF-based RGBA/XYZ edit operations applied to splats in world space.  
Shapes: `ALL`, `PLANE`, `SPHERE`, `BOX`, `ELLIPSOID`, `CYLINDER`, `CAPSULE`, `INFINITE_CONE`  
Blend modes: `MULTIPLY` (default), `SET_RGB`, `ADD_RGBA`

Add as child of `SplatMesh` (scoped) or scene root (global to all editable meshes).

### `SparkControls` / `FpsMovement` / `PointerControls`
Built-in camera controls: WASD + mouse, gamepad, mobile multi-touch, WebXR sticks.

---

## Level-of-Detail (LoD) System (Spark 2.0)

Spark builds a **coarse-to-fine splat tree** to render huge scenes within a fixed splat budget.

| Approach | How |
|---|---|
| On-the-fly (tiny-lod) | `new SplatMesh({ url, lod: true })` – builds in background WebWorker (1–3 s per 1 M splats) |
| Pre-built (recommended) | `npm run build-lod -- my.ply --quality` → `my-lod.rad`, load normally |
| Streaming | `new SplatMesh({ url: "my-lod.rad", paged: true })` – HTTP Range requests, LRU page table |

Key tuning params on `SparkRenderer`: `lodSplatScale`, `lodSplatCount`, `coneFov0/coneFov/coneFoveate/behindFoveate`  
Per-mesh override: `SplatMesh.lodScale`

Platform default splat budgets: Quest 1 M, Android 1 M, iOS 1.5 M, desktop 2.5 M

---

## Dyno Shader Graph System

The `dyno` namespace is Spark's GPU compute graph: write computation graphs in TypeScript that are compiled to GLSL and run on the GPU. All exports live in the `dyno` object from `dist/spark.module.js`.

### Naming conventions
| Style | Usage |
|---|---|
| PascalCase | Constructor classes: `DynoMat4`, `DynoBool`, `DynoFloat` |
| camelCase | Factory functions: `dynoBlock`, `dynoConst`, `dynoFloat(val)` |
| camelCase | Math / ops: `mul`, `add`, `select`, `swizzle`, `combineGsplat` |

### Core types
- `DynoVal<T>` – a typed value node in the graph
- `Dyno<InTypes, OutTypes>` – a function block with named inputs/outputs
- `DynoBlock` / `dynoBlock(inTypes, outTypes, closure)` – inline subgraph module
- `DynoUniform` / `dynoBool(v)`, `dynoFloat(v)`, `dynoVec3(v)`, `dynoMat4(v)` … – per-frame updatable uniforms

### Key type rules
```ts
dynoBool(false)             // positional arg, NOT { value: false }
splitGsplat(gsplat).outputs.flags   // type "uint"
splitGsplat(gsplat).outputs.center  // type "vec3"
extendVec(vec3, float)      // → "vec4"
mul(mat4, vec4)             // → "vec4"
swizzle(vec4, "x")          // single char → "float" scalar
select(cond, t, f)          // ternary: cond ? t : f
combineGsplat({ gsplat, flags: newFlags }) // unspecified fields fall back to gsplat
```

### Gsplat struct fields
| Field | Type | Description |
|---|---|---|
| `center` | `vec3` | World-space center |
| `flags` | `uint` | Bit 0 = active |
| `scales` | `vec3` | XYZ scales |
| `index` | `int` | Source index |
| `quaternion` | `vec4` | Orientation |
| `rgba` | `vec4` | Color + opacity |

### Injection points on `SplatMesh`
- `objectModifiers` – applied in object space before world transform
- `worldModifiers` – applied in world space after transform

---

## File Formats

| Format | Notes |
|---|---|
| `.ply` | Standard + SuperSplat/gsplat compressed – auto-detected |
| `.spz` | Niantic compressed – auto-detected |
| `.sog` / `.zip` | PlayCanvas SOGS – auto-detected |
| `.rad` | Spark LoD tree format, supports HTTP Range streaming |
| `.splat` | antimatter15 – needs URL extension or `fileType` |
| `.ksplat` | mkkellogg – needs URL extension or `fileType` |

---

## Build & Dev Commands

| Command | Purpose |
|---|---|
| `npm run build:wasm` | Compile Rust → WASM (needs Rust toolchain) |
| `npm run build` | Build JS bundle (no WASM rebuild) |
| `npm run dev` | Dev server at http://localhost:8080 |
| `npm test` | Run tests |
| `npm run lint` / `lint:fix` | Biome linter |
| `npm run format` / `format:fix` | Biome formatter |
| `npm run build-lod -- <files>` | CLI: pre-build LoD `.RAD` from splat files |
| `docker compose build` | Rebuild Docker image for examples site |
| `docker compose up -d --force-recreate` | Restart examples container |

> ⚠️ `dist/spark.module.js` embeds compiled Rust/WASM – **never edit manually**.  
> TypeScript changes to `src/` have **no runtime effect** without a full WASM rebuild (`npm run build:wasm && npm run build`).

---

## Architecture Data Flow

```
THREE.js render loop
  └─ renderer.render(scene, camera)
       └─ SparkRenderer (THREE.Object3D in scene)
            ├─ Traverses scene → finds SplatGenerator instances
            ├─ GPU: SplatAccumulator.generate() — dyno programs → PackedSplats
            ├─ GPU: Readback — compute sort-distance metric per splat
            ├─ Worker: SplatWorker — bucket-sort splat indices (background)
            └─ GPU: single instanced draw call — all splats back-to-front
```

Sort lags render by 1+ frames (imperceptible). Multiple `SparkViewpoint`s supported for multi-camera scenes.

---

## Procedural Splat Constructors

| Function | Description |
|---|---|
| `constructGrid({ splats, extents, … })` | 3D grid of spherical splats |
| `constructAxes({ splats, … })` | XYZ axis indicator |
| `constructSpherePoints({ splats, … })` | Subdivided sphere surface |
| `textSplats({ text, … })` | Rasterized text as splats |
| `imageSplats({ url, … })` | Image pixels as splats |
| `generators.snowBox(…)` | Animated falling-particle effect |
| `generators.staticBox(…)` | Static random noise in a box |

---

## Frustum Culling Helper (`examples/js/frustum.js`)

```js
const { makeFrustumCullModifier, updateFrustumUniforms, setSortClipXY } =
  createFrustumCulling();

// Add modifier to SplatMesh
mesh.worldModifiers = [makeFrustumCullModifier()];

// Call after all controller updates and localFrame.updateMatrixWorld(true)
updateFrustumUniforms(camera);
```

- `spark.clipXY` – GPU-side NDC clip (default 1.1)
- `sortClipXY` – CPU-side cull bound (default 2.0)

---

## Performance Rules of Thumb

| Platform | Splat budget |
|---|---|
| Quest 3 | ≤ 1 M, avoid clusters |
| Android | 1–2 M |
| iPhone | 1–3 M |
| Desktop | 1–5 M (10–20 M+ on high-end) |

- Set `antialias: false` on `THREE.WebGLRenderer` (no benefit for splats, big cost)
- Lower `SparkRenderer.maxStdDev` (e.g. `Math.sqrt(5)`) for VR performance
- Use LoD (`lod: true` or `.rad` files) for scenes > ~500 K splats
- Use `ExtSplats` only where large coordinates cause float16 artifacts

---

## lil-gui Safety Rule

`gui.add(obj, "prop")` **crashes** if `obj.prop === undefined`.  
Always guard with a proxy object or default value before adding to GUI.
