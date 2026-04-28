import * as THREE from "three";

const PAN_SPEED        = 0.003;
const ROTATE_SPEED     = 0.003;
const ROT_FRICTION     = 6.0;   // right-click momentum decay rate
const MAX_ROT_VEL      = 3.0;   // rad/s cap for rotation momentum
const WHEEL_SPEED      = 0.001;
const WHEEL_FRICTION   = 5.0;   // wheel dolly momentum decay rate
const MOVE_SPEED       = 5.0;   // units/s (WASD)
const FLY_SPEED        = 8.0;   // units/s target speed (left-click)
const FLY_ACCEL        = 4.0;   // ease-in rate  (higher = faster ramp-up)
const FLY_DECEL        = 6.0;   // ease-out rate (higher = faster stop)
const LOOK_EASE        = 4.0;   // look-at slerp convergence speed
const LOOK_EASE_IN     = 3.0;   // look-at ease-in ramp rate (0→1/s)

/**
 * Desktop web controller:
 *   - Left click (hold)    → fly toward cursor + orient camera toward hit point
 *                            both with smooth ease in / ease out
 *   - Middle mouse + drag  → pan (translate)
 *   - Right click + drag   → rotate (yaw + pitch) with momentum after release
 *   - Mouse wheel          → dolly with momentum
 *   - W/A/S/D              → fly forward / left / back / right
 *
 * @param {{ renderer, camera, localFrame, world }} opts
 * @returns {{ update(): void }}
 */
export function createWebController({ renderer, camera, localFrame, world }) {
  const canvas = renderer.domElement;

  let button = -1;
  let lastX  = 0;
  let lastY  = 0;

  // Right-click rotation momentum
  let rotVelX        = 0;
  let rotVelY        = 0;
  let lastRotMoveTime = 0;

  // Wheel dolly momentum
  const wheelMom    = new THREE.Vector3();
  const dollyTarget = new THREE.Vector3();

  // Left-click fly state
  const flyVel      = new THREE.Vector3(); // current fly velocity (units/s)
  let   lookStrength = 0;                  // 0→1 ease-in ramp for look-at

  const raycaster = new THREE.Raycaster();
  const ndcMouse  = new THREE.Vector2();

  const keys = new Set();
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup",   (e) => keys.delete(e.code));

  let lastTime = performance.now();

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Old left-mouse behavior (kept as reference):
   * drag up/down dollies toward / away from the clicked target point.
   */
  function leftMouseDolly(dy, target) { // eslint-disable-line no-unused-vars
    const DOLLY_SPEED = 0.005;
    const camPos   = camera.getWorldPosition(new THREE.Vector3());
    const toTarget = new THREE.Vector3().subVectors(target, camPos);
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
      rotVelX = rotVelY = 0;
      lastRotMoveTime = performance.now();
    }
    if (e.button === 0) {
      // Reset ease-in so each press starts fresh
      lookStrength = 0;
    }
    e.preventDefault();
  });

  canvas.addEventListener("mousemove", (e) => {
    // Keep NDC current for fly-toward raycasting and wheel
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
      // Rotate + EWMA velocity for momentum
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
      const camPos  = camera.getWorldPosition(new THREE.Vector3());
      const camQuat = camera.getWorldQuaternion(new THREE.Quaternion());
      const fwd     = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      const prev    = dollyTarget.distanceTo(camPos);
      dollyTarget.copy(camPos).addScaledVector(fwd, prev > 0.1 ? prev : 5.0);
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

  const _up      = new THREE.Vector3(0, 1, 0);
  const _lookMat = new THREE.Matrix4();
  const _lookQ   = new THREE.Quaternion();
  const _targetV = new THREE.Vector3();

  return {
    update() {
      const now   = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1); // cap to avoid spiral on tab-switch
      lastTime    = now;

      // ── Left-click: fly toward + look at cursor point ─────────────────────
      if (button === 0) {
        raycaster.setFromCamera(ndcMouse, camera);
        const hits   = raycaster.intersectObject(world, false);
        const camPos = camera.getWorldPosition(new THREE.Vector3());

        let flyDir;
        let lookTarget;

        if (hits.length > 0) {
          const toHit = new THREE.Vector3().subVectors(hits[0].point, camPos);
          const dist  = toHit.length();
          if (dist > 0.05) {
            flyDir     = toHit.clone().divideScalar(dist);
            lookTarget = hits[0].point;
          }
        }
        if (!flyDir) {
          // No splat hit — fly along ray, look 5 m ahead
          flyDir     = raycaster.ray.direction.clone();
          lookTarget = camPos.clone().addScaledVector(flyDir, 5.0);
        }

        // Ease-in: accelerate flyVel toward target speed
        _targetV.copy(flyDir).multiplyScalar(FLY_SPEED);
        flyVel.lerp(_targetV, 1 - Math.exp(-FLY_ACCEL * delta));

        // Ease-in: ramp up look strength, then slerp toward look target
        lookStrength = Math.min(1, lookStrength + delta * LOOK_EASE_IN);
        _lookMat.lookAt(camPos, lookTarget, _up);
        _lookQ.setFromRotationMatrix(_lookMat);
        localFrame.quaternion.slerp(_lookQ, lookStrength * (1 - Math.exp(-LOOK_EASE * delta)));

      } else {
        // Ease-out: decay flyVel to zero after button release
        flyVel.multiplyScalar(Math.exp(-FLY_DECEL * delta));
        lookStrength = 0; // reset ramp for next press
      }

      // Apply fly velocity
      if (flyVel.lengthSq() > 0.0001) {
        localFrame.position.addScaledVector(flyVel, delta);
      }

      // ── Right-click rotation momentum ────────────────────────────────────
      if (button !== 2 && (Math.abs(rotVelX) > 0.0001 || Math.abs(rotVelY) > 0.0001)) {
        const yaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotVelY * delta);
        const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotVelX * delta);
        localFrame.quaternion.premultiply(yaw).multiply(pitch);
        const damp = Math.exp(-ROT_FRICTION * delta);
        rotVelX *= damp;
        rotVelY *= damp;
      }

      // ── Wheel dolly momentum ──────────────────────────────────────────────
      if (wheelMom.lengthSq() > 0.00001) {
        localFrame.position.addScaledVector(wheelMom, delta);
        wheelMom.multiplyScalar(Math.exp(-WHEEL_FRICTION * delta));
      }

      // ── WASD ──────────────────────────────────────────────────────────────
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
