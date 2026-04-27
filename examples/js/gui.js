import GUI from "lil-gui";
import { dyno } from "@sparkjsdev/spark";

/**
 * Creates a splat index coloring dyno bool and a factory for the coloring modifier.
 *
 * @returns {{
 *   splatColoring: object,
 *   makeSplatIndexColoring: () => object
 * }}
 */
export function createSplatColoring() {
  const splatColoring = dyno.dynoBool(false);

  function makeSplatIndexColoring() {
    return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      let { index, rgb } = dyno.splitGsplat(gsplat).outputs;
      const debugRgb = dyno.debugColorHue(dyno.shr(index, dyno.dynoConst("int", 12)));
      rgb = dyno.select(splatColoring, dyno.mul(debugRgb, rgb), rgb);
      return { gsplat: dyno.combineGsplat({ gsplat, rgb }) };
    });
  }

  return { splatColoring, makeSplatIndexColoring };
}

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * Creates the Settings GUI panel with LoD and coloring controls plus a live splat counter.
 * Also adds a Camera Pose folder with live position / rotation inputs.
 *
 * @param {{
 *   spark: object,
 *   world: object,
 *   splatColoring: object,
 *   frustumSettings: { sortClipR: number },
 *   onSplatUpdate: () => void,
 *   onSortClipRChange: (v: number) => void
 * }} options
 * @returns {{
 *   gui: GUI,
 *   debugInfo: { splatCount: number },
 *   poseControls: { update(localFrame: object): void }
 * }}
 */
export function createGui({ spark, world, splatColoring, frustumSettings, onSplatUpdate, onSortClipRChange }) {
  const gui = new GUI({ title: "Settings" });
  gui.add(world, "enableLod").name("Enable LoD").onChange(onSplatUpdate);
  gui.add(spark, "lodSplatCount", 10000, 250000, 10000).name("LoD splat count");

  if (frustumSettings) {
    gui.add(frustumSettings, "sortClipR", 0.5, 2.0, 0.05)
      .name("Cull radius (1=viewport)")
      .onChange(v => onSortClipRChange?.(v));
  }

  gui.add(splatColoring, "value").name("Splat index coloring").onChange(onSplatUpdate);

  const debugInfo = { splatCount: 0 };
  gui.add(debugInfo, "splatCount").name("Sorted splats (CPU)").listen().disable();

  // ── Camera Pose ────────────────────────────────────────────────────────────────
  // Internal reference to the localFrame — set on first poseControls.update() call.
  let _frame = null;

  // Plain JS object that lil-gui binds to. listen() re-reads it every frame but
  // skips focused inputs, so the user can type freely without getting overwritten.
  const pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

  // Write GUI values back to the localFrame (called via onChange).
  function syncToFrame() {
    if (!_frame) return;
    _frame.position.set(pose.x, pose.y, pose.z);
    // Preserve existing Euler order (SparkControls default is 'XYZ')
    _frame.rotation.set(pose.rx * RAD, pose.ry * RAD, pose.rz * RAD);
  }

  const poseFolder = gui.addFolder("Camera Pose");
  const posFolder  = poseFolder.addFolder("Position");
  posFolder.add(pose, "x").name("X").step(0.001).listen().onChange(syncToFrame);
  posFolder.add(pose, "y").name("Y").step(0.001).listen().onChange(syncToFrame);
  posFolder.add(pose, "z").name("Z").step(0.001).listen().onChange(syncToFrame);

  const rotFolder = poseFolder.addFolder("Rotation (°)");
  rotFolder.add(pose, "rx").name("Pitch").step(0.1).listen().onChange(syncToFrame);
  rotFolder.add(pose, "ry").name("Yaw").step(0.1).listen().onChange(syncToFrame);
  rotFolder.add(pose, "rz").name("Roll").step(0.1).listen().onChange(syncToFrame);

  /**
   * Call once per frame after controllers update localFrame.
   * Reads localFrame → updates display. Skips focused inputs automatically.
   * @param {THREE.Object3D} localFrame
   */
  const poseControls = {
    update(localFrame) {
      _frame = localFrame;
      pose.x  = +localFrame.position.x.toFixed(3);
      pose.y  = +localFrame.position.y.toFixed(3);
      pose.z  = +localFrame.position.z.toFixed(3);
      pose.rx = +(localFrame.rotation.x * DEG).toFixed(2);
      pose.ry = +(localFrame.rotation.y * DEG).toFixed(2);
      pose.rz = +(localFrame.rotation.z * DEG).toFixed(2);
    },
  };

  return { gui, debugInfo, poseControls };
}
