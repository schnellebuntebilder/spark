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
  const settings = { sortClipR: 1.0 };

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
   */
  function updateFrustumUniforms(camera, mesh) {
    // The objectModifier sees gsplat centers in OBJECT space.
    // We need P * V * M (MVP) so the frustum test is correct.
    viewProjUniform.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);

    // Keep aspect-ratio scale factors in sync with the current viewport
    const w = window.innerWidth;
    const h = window.innerHeight;
    const minDim = Math.min(w, h);
    scaleXUniform.value = w / minDim;
    scaleYUniform.value = h / minDim;
  }

  function setSortClipR(v) {
    settings.sortClipR = v;
    sortClipRUniform.value = v;
  }

  return { settings, makeFrustumCullModifier, updateFrustumUniforms, setSortClipR };
}
