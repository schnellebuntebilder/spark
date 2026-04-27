import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

/**
 * Creates CPU-side radial frustum culling via a SplatMesh objectModifier.
 *
 * Splats outside a circular region (inscribed in the shorter viewport edge) are
 * marked inactive (flags = 0) so the sort depth shader returns INFINITY for them.
 *
 * @returns {{
 *   settings: { sortClipR: number },
 *   makeFrustumCullModifier: () => object,
 *   updateFrustumUniforms: (camera: THREE.Camera, mesh: THREE.Object3D) => void,
 *   setSortClipR: (v: number) => void
 * }}
 */
export function createFrustumCulling() {
  const viewProjUniform = new dyno.DynoMat4({ value: new THREE.Matrix4() });
  // Scale factors: NDC * scale maps to a coordinate space where 1.0 = half of min(w, h)
  const scaleXUniform = new dyno.DynoFloat({ value: 1.0 }); // w / min(w, h)
  const scaleYUniform = new dyno.DynoFloat({ value: 1.0 }); // h / min(w, h)
  const sortClipRUniform = new dyno.DynoFloat({ value: 1.0 });
  // 1.1 = 10 % Puffer über die Viewport-Diagonale hinaus (1.0 = exakt alle Ecken eingeschlossen)
  const settings = { sortClipR: 1.1 };

  function makeFrustumCullModifier() {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const { center, flags } = dyno.splitGsplat(gsplat).outputs;

        // Project splat center to clip space via MVP: vec4 = MVP * vec4(center, 1.0)
        const centerH = dyno.mul(
          viewProjUniform,
          dyno.extendVec(center, dyno.dynoConst("float", 1.0))
        );

        const w = dyno.swizzle(centerH, "w");
        const ndcX = dyno.div(dyno.swizzle(centerH, "x"), w);
        const ndcY = dyno.div(dyno.swizzle(centerH, "y"), w);

        // Radial distance scaled so that 1.0 = radius of the inscribed circle
        const scaledX = dyno.mul(ndcX, scaleXUniform);
        const scaledY = dyno.mul(ndcY, scaleYUniform);
        const dist2 = dyno.add(dyno.mul(scaledX, scaledX), dyno.mul(scaledY, scaledY));
        const clip2 = dyno.mul(sortClipRUniform, sortClipRUniform);

        const behindCamera = dyno.lessThanEqual(w, dyno.dynoConst("float", 0.0));
        const outsideRadius = dyno.greaterThan(dist2, clip2);
        const outside = dyno.or(outsideRadius, behindCamera);

        // If outside cull circle, mark splat inactive (flags = 0)
        const newFlags = dyno.select(outside, dyno.dynoConst("uint", 0), flags);
        return { gsplat: dyno.combineGsplat({ gsplat, flags: newFlags }) };
      }
    );
  }

  /**
   * Call once per frame before rendering to keep the MVP matrix and aspect ratio current.
   * @param {THREE.Camera} camera
   * @param {THREE.Object3D} mesh - the SplatMesh whose objectModifier this is
   * @param {boolean} [lodActive=false] - when true, culling is effectively disabled
   *   (LoD splats are large; center-point culling would incorrectly hide whole regions)
   */
  function updateFrustumUniforms(camera, mesh, lodActive = false) {
    // The objectModifier sees gsplat centers in OBJECT space.
    // We need P * V * M (MVP) so the frustum test is correct.
    viewProjUniform.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);

    // Keep aspect-ratio scale factors in sync with the current viewport.
    // scaleX = w/min(w,h), scaleY = h/min(w,h) — so the inscribed circle has radius 1.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const minDim = Math.min(w, h);
    const sx = w / minDim;
    const sy = h / minDim;
    scaleXUniform.value = sx;
    scaleYUniform.value = sy;

    if (lodActive) {
      // LoD splats can be very large; disable culling to avoid whole-region drop-outs.
      sortClipRUniform.value = 99999.0;
    } else {
      // Normalize sortClipR by the viewport diagonal so that:
      //   sortClipR = 1.0  → circle just covers all four viewport corners
      //   sortClipR = 1.1  → 10 % margin beyond corners (default, nothing visible is culled)
      //   sortClipR < 1.0  → aggressive: corners are cut off
      const diagonal = Math.sqrt(sx * sx + sy * sy);
      sortClipRUniform.value = settings.sortClipR * diagonal;
    }
  }

  function setSortClipR(v) {
    settings.sortClipR = v;
    // sortClipRUniform.value is updated each frame by updateFrustumUniforms
  }

  return { settings, makeFrustumCullModifier, updateFrustumUniforms, setSortClipR };
}
