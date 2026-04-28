import * as THREE from "three";

const PINCH_SPEED      = 8.0;   // metres of movement per pixel of pinch delta
const PINCH_SCALE      = 0.001; // raw pixel delta → speed scale
const PINCH_DAMPING    = 0.85;  // pinch velocity decay per frame

const ROTATE_SPEED     = 0.004; // rad per pixel of single-finger drag
const ROT_DAMPING      = 0.85;  // rotation momentum decay per frame
const MAX_ROT_VEL      = 3.0;   // rad/s cap

const DOUBLE_TAP_MS    = 300;   // max ms between taps to register as double-tap
const DOUBLE_TAP_PX    = 30;    // max pixel distance between the two taps
const DOUBLE_TAP_BOOST = 0.4;   // initial per-frame displacement toward tapped direction
const TAP_DAMPING      = 0.78;  // tap velocity decay per frame

/**
 * Touch controller:
 *   • Single-finger drag → rotate (yaw + pitch), same axes as right-click in web controller.
 *   • Two-finger pinch   → move forward / backward along camera look axis.
 *   • Double-tap         → dash toward the tapped screen position (ray direction).
 *
 * @param {{ camera: THREE.Camera, localFrame: THREE.Object3D }} opts
 * @returns {{ update(delta: number): void }}
 */
export function createTouchController({ camera, localFrame }) {

  // ─── Pinch state ────────────────────────────────────────────────────────────
  let pinchLastDist  = null;
  let pinchVelocity  = 0;

  const _fwd = new THREE.Vector3();

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  // ─── Single-finger rotation state ───────────────────────────────────────────
  let dragLastX     = null;
  let dragLastY     = null;
  let rotVelX       = 0;   // pitch momentum (rad/s)
  let rotVelY       = 0;   // yaw   momentum (rad/s)
  let lastRotTime   = 0;

  const _yawAxis   = new THREE.Vector3(0, 1, 0);
  const _pitchAxis = new THREE.Vector3(1, 0, 0);
  const _qYaw      = new THREE.Quaternion();
  const _qPitch    = new THREE.Quaternion();

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
      // Cancel single-finger drag if a second finger lands
      dragLastX = dragLastY = null;
    } else if (e.touches.length === 1) {
      pinchLastDist = null;
      dragLastX = e.touches[0].clientX;
      dragLastY = e.touches[0].clientY;
      lastRotTime = performance.now();
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchLastDist !== null) {
      const dist    = getTouchDist(e.touches);
      pinchVelocity = (dist - pinchLastDist) * PINCH_SPEED * PINCH_SCALE;
      pinchLastDist = dist;
    } else if (e.touches.length === 1 && dragLastX !== null) {
      const now = performance.now();
      const dt  = Math.max((now - lastRotTime) / 1000, 0.001);
      lastRotTime = now;

      const dx = e.touches[0].clientX - dragLastX;
      const dy = e.touches[0].clientY - dragLastY;
      dragLastX = e.touches[0].clientX;
      dragLastY = e.touches[0].clientY;

      const rdx = -dx * ROTATE_SPEED;
      const rdy = -dy * ROTATE_SPEED;

      // EWMA velocity for momentum after lift
      rotVelY = Math.max(-MAX_ROT_VEL, Math.min(MAX_ROT_VEL, 0.5 * rotVelY + 0.5 * (rdx / dt)));
      rotVelX = Math.max(-MAX_ROT_VEL, Math.min(MAX_ROT_VEL, 0.5 * rotVelX + 0.5 * (rdy / dt)));

      _qYaw.setFromAxisAngle(_yawAxis, rdx);
      _qPitch.setFromAxisAngle(_pitchAxis, rdy);
      localFrame.quaternion.premultiply(_qYaw).multiply(_qPitch);
    }
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    pinchLastDist = null;

    if (e.touches.length === 0) {
      dragLastX = dragLastY = null;
    }

    // Double-tap detection (single-finger only)
    if (e.changedTouches.length !== 1 || e.touches.length !== 0) return;

    const touch = e.changedTouches[0];
    const now   = Date.now();
    const dx    = touch.clientX - lastTapX;
    const dy    = touch.clientY - lastTapY;

    if (now - lastTapTime < DOUBLE_TAP_MS && Math.hypot(dx, dy) < DOUBLE_TAP_PX) {
      _ndc.set(
        (touch.clientX / window.innerWidth)  *  2 - 1,
        (touch.clientY / window.innerHeight) * -2 + 1,
      );
      _raycaster.setFromCamera(_ndc, camera);
      tapVelocity.copy(_raycaster.ray.direction).multiplyScalar(DOUBLE_TAP_BOOST);
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX    = touch.clientX;
      lastTapY    = touch.clientY;
    }
  }, { passive: true });

  // ─── Per-frame update ────────────────────────────────────────────────────────
  return {
    update(delta) {
      // Pinch — move along camera forward
      if (Math.abs(pinchVelocity) > 0.0001) {
        camera.getWorldDirection(_fwd);
        localFrame.position.addScaledVector(_fwd, pinchVelocity);
        pinchVelocity *= PINCH_DAMPING;
      }

      // Rotation momentum after finger lift
      if (dragLastX === null && (Math.abs(rotVelY) > 0.001 || Math.abs(rotVelX) > 0.001)) {
        _qYaw.setFromAxisAngle(_yawAxis, rotVelY * delta);
        _qPitch.setFromAxisAngle(_pitchAxis, rotVelX * delta);
        localFrame.quaternion.premultiply(_qYaw).multiply(_qPitch);
        rotVelY *= ROT_DAMPING;
        rotVelX *= ROT_DAMPING;
      }

      // Double-tap — move along the tapped ray direction
      if (tapVelocity.lengthSq() > 0.000001) {
        localFrame.position.add(tapVelocity);
        tapVelocity.multiplyScalar(TAP_DAMPING);
      }
    },
  };
}
