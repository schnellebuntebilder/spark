import * as THREE from "three";
import { SparkXr } from "@sparkjsdev/spark";

const LAUNCH_SPEED  = 8.0;
const GRAVITY       = 9.8;
const TIME_STEP     = 0.05;
const ARC_SEGMENTS  = 50;
const FLOOR_Y       = -1.0;
const HM_CELL       = 0.5;
const FADE_DURATION = 0.25;

/**
 * Quest / WebXR controller: teleport arc, fade system, gamepad input.
 * @param {{ renderer, scene, camera, localFrame, world }} opts
 * @returns {{ update(delta: number): { bPressed: boolean, fovPlus: boolean, fovMinus: boolean } }}
 */
export function createQuestController({ renderer, scene, camera, localFrame, world }) {

  // ─── Height Map ─────────────────────────────────────────────────────────────
  let heightGrid = null;

  function buildHeightGrid() {
    const grid = new Map();
    world.forEachSplat((_i, center) => {
      const wx = center.x + world.position.x;
      const wy = center.y + world.position.y;
      const wz = center.z + world.position.z;
      const cx = Math.floor(wx / HM_CELL);
      const cz = Math.floor(wz / HM_CELL);
      const key = `${cx},${cz}`;
      const cell = grid.get(key);
      if (cell) { cell.sum += wy; cell.count++; }
      else grid.set(key, { sum: wy, count: 1 });
    });
    if (grid.size === 0) return;
    heightGrid = grid;
    console.log(`Teleport height grid: ${grid.size} cells`);
  }

  // Average terrain Y in a 5×5 cell window around (x, z)
  function getTerrainHeight(x, z) {
    if (!heightGrid) return FLOOR_Y;
    const cx = Math.floor(x / HM_CELL);
    const cz = Math.floor(z / HM_CELL);
    let sum = 0, count = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cell = heightGrid.get(`${cx + dx},${cz + dz}`);
        if (cell) { sum += cell.sum; count += cell.count; }
      }
    }
    return count > 0 ? sum / count : FLOOR_Y;
  }

  // ─── Fade System ─────────────────────────────────────────────────────────────
  let fadeState         = "idle"; // "idle" | "fading-out" | "fading-in"
  let fadeProgress      = 0;
  let fadePendingTarget = null;

  // ─── Arc Tube ─────────────────────────────────────────────────────────────────
  const arcMaterial = new THREE.MeshBasicMaterial({ color: 0x44ccff, side: THREE.DoubleSide });
  let arcTube = null;

  // ─── Target Marker ────────────────────────────────────────────────────────────
  const markerGroup = new THREE.Group();
  markerGroup.visible = false;
  scene.add(markerGroup);
  markerGroup.add(new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.40, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x44ccff, side: THREE.DoubleSide }),
  ));
  markerGroup.add(new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.30, side: THREE.DoubleSide }),
  ));

  // ─── XR / SparkXr Setup ───────────────────────────────────────────────────────
  new SparkXr({
    renderer,
    onMouseLeaveOpacity: 0.5,
    onReady: (supported) => console.log(`SparkXr: VR ${supported ? "supported" : "not supported"}`),
    controllers: {
      getMove:   () => new THREE.Vector3(),
      getRotate: () => new THREE.Vector3(),
      getFast:   () => false,
      getSlow:   () => false,
    },
  });

  let rightController = null;
  const ctrl0 = renderer.xr.getController(0);
  const ctrl1 = renderer.xr.getController(1);
  // Add to localFrame so world position stays correct after teleporting
  localFrame.add(ctrl0);
  localFrame.add(ctrl1);

  for (const ctrl of [ctrl0, ctrl1]) {
    ctrl.addEventListener("connected", (e) => {
      if (e.data.handedness === "right") rightController = ctrl;
    });
    ctrl.addEventListener("disconnected", () => {
      if (rightController === ctrl) rightController = null;
    });
  }

  let triggerWasPressed = false;
  let teleportTarget    = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function computeBallisticArc(origin, direction) {
    const points = [];
    const vel    = direction.clone().multiplyScalar(LAUNCH_SPEED);
    const pos    = origin.clone();
    let hitPoint = null;

    for (let i = 0; i < ARC_SEGMENTS; i++) {
      points.push(pos.clone());

      if (i > 0) {
        const terrainY = getTerrainHeight(pos.x, pos.z);
        if (pos.y <= terrainY) {
          const prev = points[i - 1];
          const t    = (terrainY - prev.y) / (pos.y - prev.y);
          hitPoint   = prev.clone().lerp(pos, t);
          hitPoint.y = terrainY;
          while (points.length < ARC_SEGMENTS) points.push(hitPoint.clone());
          break;
        }
      }

      vel.y -= GRAVITY * TIME_STEP;
      pos.x += vel.x * TIME_STEP;
      pos.y += vel.y * TIME_STEP;
      pos.z += vel.z * TIME_STEP;
    }

    return { points, hitPoint };
  }

  function updateArcTube(points) {
    if (arcTube) { scene.remove(arcTube); arcTube.geometry.dispose(); arcTube = null; }
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points);
    const geo   = new THREE.TubeGeometry(curve, Math.max(points.length, 20), 0.012, 6, false);
    arcTube = new THREE.Mesh(geo, arcMaterial);
    arcTube.frustumCulled = false;
    scene.add(arcTube);
  }

  function showTeleportUI(hitPoint) {
    if (hitPoint) {
      markerGroup.position.set(hitPoint.x, hitPoint.y + 0.01, hitPoint.z);
      markerGroup.visible = true;
    } else {
      markerGroup.visible = false;
    }
  }

  function hideTeleportUI() {
    if (arcTube) { scene.remove(arcTube); arcTube.geometry.dispose(); arcTube = null; }
    markerGroup.visible = false;
  }

  function performTeleport(target) {
    const camWorld = camera.getWorldPosition(new THREE.Vector3());
    localFrame.position.x += target.x - camWorld.x;
    localFrame.position.z += target.z - camWorld.z;
  }

  // ─── Per-Frame Update ─────────────────────────────────────────────────────────
  return {
    update(delta) {
      if (!heightGrid) buildHeightGrid();

      // Fade
      if (fadeState === "fading-out") {
        fadeProgress = Math.min(1, fadeProgress + delta / FADE_DURATION);
        world.opacity = 1 - fadeProgress;
        if (fadeProgress >= 1) {
          if (fadePendingTarget) performTeleport(fadePendingTarget);
          fadePendingTarget = null;
          fadeProgress = 0;
          fadeState = "fading-in";
        }
      } else if (fadeState === "fading-in") {
        fadeProgress = Math.min(1, fadeProgress + delta / FADE_DURATION);
        world.opacity = fadeProgress;
        if (fadeProgress >= 1) {
          world.opacity = 1;
          fadeState = "idle";
        }
      }

      // Gamepad: right trigger + B button; left trigger + X button for FOV
      let triggerPressed = false;
      let bPressed       = false;
      let fovPlus        = false;
      let fovMinus       = false;

      for (const source of renderer.xr.getSession()?.inputSources ?? []) {
        if (source.handedness === "right" && source.gamepad) {
          triggerPressed = source.gamepad.buttons[0]?.pressed ?? false;
          bPressed       = source.gamepad.buttons[5]?.pressed ?? false;
        }
        if (source.handedness === "left" && source.gamepad) {
          fovPlus  = source.gamepad.buttons[0]?.pressed ?? false;
          fovMinus = source.gamepad.buttons[4]?.pressed ?? false;
        }
      }

      // Teleport arc
      if (triggerPressed && rightController) {
        const origin = new THREE.Vector3();
        const quat   = new THREE.Quaternion();
        rightController.getWorldPosition(origin);
        rightController.getWorldQuaternion(quat);
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
        const { points, hitPoint } = computeBallisticArc(origin, direction);
        updateArcTube(points);
        showTeleportUI(hitPoint);
        teleportTarget = hitPoint;
      } else if (!triggerPressed && triggerWasPressed) {
        if (teleportTarget && fadeState === "idle") {
          fadePendingTarget = teleportTarget.clone();
          fadeState = "fading-out";
          fadeProgress = 0;
        }
        hideTeleportUI();
        teleportTarget = null;
      } else if (!triggerPressed) {
        hideTeleportUI();
      }

      triggerWasPressed = triggerPressed;

      return { bPressed, fovPlus, fovMinus };
    },
  };
}
