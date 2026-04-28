import * as THREE from "three";

const PAN_SPEED        = 0.003;
const ROTATE_SPEED     = 0.003;
const ROT_FRICTION     = 6.0;   // right-click momentum decay rate (higher = snappier stop)
const MAX_ROT_VEL      = 3.0;   // rad/s cap for rotation momentum
const WHEEL_SPEED      = 0.001;
const WHEEL_FRICTION   = 5.0;   // wheel position momentum decay rate
const MOVE_SPEED       = 5.0;   // units per second (WASD)
const FLY_SPEED        = 8.0;   // units per second (left-click fly-toward)

/**
 * Desktop web controller:
 *   - Middle mouse + drag  → pan (translate)
 *   - Right click + drag   → rotate (yaw + pitch) with momentum after release
 *   - Left click (hold)    → fly continuously toward the point under the cursor
 *   - Mouse wheel          → dolly with position momentum
 *   - W/A/S/D              → fly forward / left / back / right
 *
 * @param {{ renderer, camera, localFrame, world }} opts
 * @returns {{ update(): void }}
 */
export function createWebController({ renderer, camera, localFrame, world }) {
  const canvas = renderer.domElement;

  let button      = -1;
  let lastX       = 0;
  let lastY       = 0;

  // Right-click rotation momentum
  let rotVelX        = 0;
  let rotVelY        = 0;
  let lastRotMoveTime = 0;

  // Wheel position momentum (velocity vector, units/s)
  const wheelMom  = new THREE.Vector3();

  const dollyTarget = new THREE.Vector3();
  const raycaster   = new THREE.Raycaster();
  const ndcMouse    = new THREE.Vector2();

  const keys = new Set();
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup",   (e) => keys.delete(e.code));

  let lastTime = performance.now();

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Old left-mouse behavior (kept as reference):
   * drag up/down dollies toward / away from the clicked target point.
   *
   * @param {number} dy         - mouse delta Y in pixels
   * @param {THREE.Vector3} dollyTarget - world-space target point
   */
  function leftMouseDolly(dy, dollyTarget) { // eslint-disable-line no-unused-vars
    const DOLLY_SPEED = 0.005;
    const camPos   = camera.getWorldPosition(new THREE.Vector3());
    const toTarget = new THREE.Vector3().subVectors(dollyTarget, camPos);
    const dist     = toTarget.length();
    if (dist > 0.01) {
      localFrame.position.addScaledVector(toTarget.divideScalar(dist), dy * DOLLY_SPEED * dist);
    }
  }

  // ── events ───────────────────────────────────────────────────────────────────

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    if (button !== -1) return;
    button = e.button;
    lastX  = e.clientX;
    lastY  = e.clientY;

    if (e.button === 2) {
      rotVelX = 0;
      rotVelY = 0;
      lastRotMoveTime = performance.now();
    }
    e.preventDefault();
  });

  canvas.addEventListener("mousemove", (e) => {
    // Always keep NDC current for wheel raycasting and fly-toward
    const rect = canvas.getBoundingClientRect();
    ndcMouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    ndcMouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    if (button < 0) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (button === 1) {
      // Pan
      const q     = camera.getWorldQuaternion(new THREE.Quaternion());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      localFrame.position.addScaledVector(right, -dx * PAN_SPEED);
      localFrame.position.addScaledVector(up,     dy * PAN_SPEED);

    } else if (button === 2) {
      // Rotate + track EWMA velocity for momentum after release
      const now2 = performance.now();
      const dt2  = Math.max((now2 - lastRotMoveTime) / 1000, 0.001);
      lastRotMoveTime = now2;

      const rdx = -dx * ROTATE_SPEED;
      const rdy = -dy * ROTATE_SPEED;
      rotVelY = Math.max(-MAX_ROT_VEL, Math.min(MAX_ROT_VEL, 0.5 * rotVelY + 0.5 * (rdx / dt2)));
      rotVelX = Math.max(-MAX_ROT_VEL, Math.min(MAX_ROT_VEL, 0.5 * rotVelX + 0.5 * (rdy / dt2)));

      const yaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rdx);
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rdy);
      localFrame.quaternion.premultiply(yaw).multiply(pitch);
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === button) button = -1;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    raycaster.setFromCamera(ndcMouse, camera);
    const hits = raycaster.intersectObject(world, false);
    if (hits.length > 0) {
      dollyTarget.copy(hits[0].point);
    } else {
      const camPos   = camera.getWorldPosition(new THREE.Vector3());
      const camQuat  = camera.getWorldQuaternion(new THREE.Quaternion());
      const forward  = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      const prevDist = dollyTarget.distanceTo(camPos);
      dollyTarget.copy(camPos).addScaledVector(forward, prevDist > 0.1 ? prevDist : 5.0);
    }

    const camPos   = camera.getWorldPosition(new THREE.Vector3());
    const toTarget = new THREE.Vector3().subVectors(dollyTarget, camPos);
    const dist     = toTarget.length();
    if (dist > 0.01) {
      const travel = e.deltaY * WHEEL_SPEED * dist;
      wheelMom.addScaledVector(toTarget.divideScalar(dist), travel * WHEEL_FRICTION);
    }
  }, { passive: false });

  // ── per-frame update ──────────────────────────────────────────────────────────

  return {
    update() {
      const now   = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime    = now;

      // Left-click held: fly continuously toward the point under the cursor
      if (button === 0) {
        raycaster.setFromCamera(ndcMouse, camera);
        const hits = raycaster.intersectObject(world, false);
        let flyDir;
        if (hits.length > 0) {
          const camPos = camera.getWorldPosition(new THREE.Vector3());
          flyDir = new THREE.Vector3().subVectors(hits[0].point, camPos).normalize();
        } else {
          flyDir = raycaster.ray.direction.clone();
        }
        localFrame.position.addScaledVector(flyDir, FLY_SPEED * delta);
      }

      // Right-click rotation momentum (active after button release)
      if (button !== 2 && (Math.abs(rotVelX) > 0.0001 || Math.abs(rotVelY) > 0.0001)) {
        const yaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotVelY * delta);
        const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotVelX * delta);
        localFrame.quaternion.premultiply(yaw).multiply(pitch);
        const damping = Math.exp(-ROT_FRICTION * delta);
        rotVelX *= damping;
        rotVelY *= damping;
      }

      // Wheel position momentum
      if (wheelMom.lengthSq() > 0.00001) {
        localFrame.position.addScaledVector(wheelMom, delta);
        wheelMom.multiplyScalar(Math.exp(-WHEEL_FRICTION * delta));
      }

      // WASD movement
      if (keys.size === 0) return;
      const q       = camera.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const right   = new THREE.Vector3(1, 0,  0).applyQuaternion(q);
      const speed   = MOVE_SPEED * delta;
      if (keys.has("KeyW")) localFrame.position.addScaledVector(forward,  speed);
      if (keys.has("KeyS")) localFrame.position.addScaledVector(forward, -speed);
      if (keys.has("KeyA")) localFrame.position.addScaledVector(right,   -speed);
      if (keys.has("KeyD")) localFrame.position.addScaledVector(right,    speed);
    },
  };
}
