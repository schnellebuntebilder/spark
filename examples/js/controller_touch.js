import * as THREE from "three";

const PINCH_SPEED      = 8.0;   // metres of movement per pixel of pinch delta
const PINCH_SCALE      = 0.001; // raw pixel delta → speed scale
const PINCH_DAMPING    = 0.85;  // velocity decay per frame (shared by pinch and double-tap)

const DOUBLE_TAP_MS    = 300;   // max ms between taps to register as double-tap
const DOUBLE_TAP_PX    = 30;    // max pixel distance between the two taps
const DOUBLE_TAP_BOOST = 5.0;   // initial speed injected toward tapped direction

/**
 * Touch controller:
 *   • Two-finger pinch  → move forward / backward along camera look axis.
 *   • Double-tap        → dash toward the tapped screen position (ray direction).
 *
 * Both motions use the same PINCH_DAMPING ease-out decay.
 *
 * @param {{ camera: THREE.Camera, localFrame: THREE.Object3D }} opts
 * @returns {{ update(delta: number): void }}
 */
export function createTouchController({ camera, localFrame }) {

  // ─── Pinch state ────────────────────────────────────────────────────────────
  let pinchLastDist  = null;
  let pinchVelocity  = 0;       // scalar along camera forward

  const _fwd = new THREE.Vector3();

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  // ─── Double-tap state ────────────────────────────────────────────────────────
  let lastTapTime = 0;
  let lastTapX    = 0;
  let lastTapY    = 0;
  const tapVelocity  = new THREE.Vector3();
  const _raycaster   = new THREE.Raycaster();
  const _ndc         = new THREE.Vector2();

  // ─── Event listeners ─────────────────────────────────────────────────────────
  window.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinchLastDist = getTouchDist(e.touches);
      pinchVelocity = 0;
    } else {
      pinchLastDist = null;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchLastDist !== null) {
      const dist    = getTouchDist(e.touches);
      pinchVelocity = (dist - pinchLastDist) * PINCH_SPEED * PINCH_SCALE;
      pinchLastDist = dist;
    }
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    pinchLastDist = null;

    // Only track single-finger taps for double-tap detection
    if (e.changedTouches.length !== 1 || e.touches.length !== 0) return;

    const touch = e.changedTouches[0];
    const now   = Date.now();
    const dx    = touch.clientX - lastTapX;
    const dy    = touch.clientY - lastTapY;

    if (now - lastTapTime < DOUBLE_TAP_MS && Math.hypot(dx, dy) < DOUBLE_TAP_PX) {
      // Double-tap confirmed — cast a ray and dash toward it
      _ndc.set(
        (touch.clientX / window.innerWidth)  *  2 - 1,
        (touch.clientY / window.innerHeight) * -2 + 1,
      );
      _raycaster.setFromCamera(_ndc, camera);
      tapVelocity.copy(_raycaster.ray.direction).multiplyScalar(DOUBLE_TAP_BOOST);
      lastTapTime = 0; // prevent triple-tap from re-triggering
    } else {
      lastTapTime = now;
      lastTapX    = touch.clientX;
      lastTapY    = touch.clientY;
    }
  }, { passive: true });

  // ─── Per-frame update ────────────────────────────────────────────────────────
  return {
    update(_delta) {
      // Pinch — move along camera forward
      if (Math.abs(pinchVelocity) > 0.0001) {
        camera.getWorldDirection(_fwd);
        localFrame.position.addScaledVector(_fwd, pinchVelocity);
        pinchVelocity *= PINCH_DAMPING;
      }

      // Double-tap — move along the tapped ray direction
      if (tapVelocity.lengthSq() > 0.000001) {
        localFrame.position.add(tapVelocity);
        tapVelocity.multiplyScalar(PINCH_DAMPING);
      }
    },
  };
}
