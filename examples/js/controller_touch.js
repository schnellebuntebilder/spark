import * as THREE from "three";

const PINCH_SPEED   = 8.0;   // metres of movement per pixel of pinch delta
const PINCH_SCALE   = 0.001; // raw pixel delta → speed scale
const PINCH_DAMPING = 0.85;  // velocity decay per frame (applied each update call)

/**
 * Touch controller: two-finger pinch → move camera forward / backward.
 *
 * Pinch out (fingers apart)  → move forward along camera look direction.
 * Pinch in  (fingers together) → move backward.
 *
 * @param {{ camera: THREE.Camera, localFrame: THREE.Object3D }} opts
 * @returns {{ update(delta: number): void }}
 */
export function createTouchController({ camera, localFrame }) {
  let pinchLastDist = null;
  let velocity      = 0; // signed m/s along camera forward

  const _dir = new THREE.Vector3();

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  window.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinchLastDist = getTouchDist(e.touches);
    } else {
      pinchLastDist = null;
      velocity = 0;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchLastDist !== null) {
      const dist  = getTouchDist(e.touches);
      // positive delta = fingers spreading = move forward
      velocity      = (dist - pinchLastDist) * PINCH_SPEED * PINCH_SCALE;
      pinchLastDist = dist;
    }
  }, { passive: true });

  window.addEventListener("touchend", () => {
    pinchLastDist = null;
    // velocity decays naturally via damping
  }, { passive: true });

  return {
    update(_delta) {
      if (Math.abs(velocity) < 0.0001) return;
      camera.getWorldDirection(_dir);
      localFrame.position.addScaledVector(_dir, velocity);
      velocity *= PINCH_DAMPING;
    },
  };
}
