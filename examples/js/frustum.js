import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

/**
 * Creates CPU-side frustum culling via a SplatMesh objectModifier.
 *
 * The modifier marks out-of-frustum splats as inactive (flags = 0) so the
 * sort depth shader returns INFINITY for them, excluding them from activeSplats.
 *
 * @returns {{
 *   settings: { sortClipXY: number },
 *   makeFrustumCullModifier: () => object,
 *   updateFrustumUniforms: (camera: THREE.Camera, mesh: THREE.Object3D) => void,
 *   setSortClipXY: (v: number) => void
 * }}
 */
export function createFrustumCulling() {
  const viewProjUniform = new dyno.DynoMat4({ value: new THREE.Matrix4() });
  const sortClipXYUniform = new dyno.DynoFloat({ value: 2.0 });
  const settings = { sortClipXY: 2.0 };

  function makeFrustumCullModifier() {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const { center, flags } = dyno.splitGsplat(gsplat).outputs;

        // Project splat center to clip space: vec4 = viewProj * vec4(center, 1.0)
        const centerH = dyno.mul(
          viewProjUniform,
          dyno.extendVec(center, dyno.dynoConst("float", 1.0))
        );

        const w = dyno.swizzle(centerH, "w");
        const ndcX = dyno.div(dyno.swizzle(centerH, "x"), w);
        const ndcY = dyno.div(dyno.swizzle(centerH, "y"), w);

        const clip = sortClipXYUniform;
        const outsideX = dyno.or(
          dyno.lessThan(ndcX, dyno.neg(clip)),
          dyno.greaterThan(ndcX, clip)
        );
        const outsideY = dyno.or(
          dyno.lessThan(ndcY, dyno.neg(clip)),
          dyno.greaterThan(ndcY, clip)
        );
        const behindCamera = dyno.lessThanEqual(w, dyno.dynoConst("float", 0.0));

        const outside = dyno.or(dyno.or(outsideX, outsideY), behindCamera);

        // If outside frustum, mark splat inactive (flags = 0)
        const newFlags = dyno.select(outside, dyno.dynoConst("uint", 0), flags);
        return { gsplat: dyno.combineGsplat({ gsplat, flags: newFlags }) };
      }
    );
  }

  /**
   * Call once per frame before rendering to keep the MVP matrix current.
   * @param {THREE.Camera} camera
   * @param {THREE.Object3D} mesh - the SplatMesh whose objectModifier this is
   */
  function updateFrustumUniforms(camera, mesh) {
    // The objectModifier sees gsplat centers in OBJECT space.
    // We need P * V * M (MVP) so the frustum test is correct.
    viewProjUniform.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);
  }

  function setSortClipXY(v) {
    settings.sortClipXY = v;
    sortClipXYUniform.value = v;
  }

  return { settings, makeFrustumCullModifier, updateFrustumUniforms, setSortClipXY };
}
