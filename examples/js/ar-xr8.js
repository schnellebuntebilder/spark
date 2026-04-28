/**
 * 8th Wall SLAM fallback AR for devices without WebXR immersive-ar (e.g. iPhone).
 *
 * Dynamically loads xr.js from local assets, then drives rendering via 8th Wall's
 * camera pipeline instead of renderer.setAnimationLoop(). The caller's existing
 * animation loop is paused while 8th Wall is active and resumed on stop.
 *
 * Usage:
 *   const xr8 = createXr8Fallback({ renderer, camera, scene, onPerFrame, onStart, onStop });
 *   await xr8.start();   // loads xr.js, starts SLAM + camera feed
 *   xr8.stop();          // ends session, resumes caller's animation loop
 *
 * @param {{
 *   renderer:   THREE.WebGLRenderer,
 *   camera:     THREE.PerspectiveCamera,
 *   scene:      THREE.Scene,
 *   onPerFrame: (delta: number) => void,  // called each frame while active (after camera pose update)
 *   onStart?:   () => void,               // called once when camera feed is ready
 *   onStop?:    () => void,               // called once when session ends
 *   xrJsPath?:  string,                   // path to xr.js (default: ../assets/8thwall/xr.js)
 * }} opts
 */
export function createXr8Fallback({
  renderer,
  camera,
  scene,
  onPerFrame,
  onStart,
  onStop,
  xrJsPath = "../assets/8thwall/xr.js",
}) {
  let active = false;
  let lastTime = 0;

  function buildModule() {
    return {
      name: "spark-xr8",

      onStart() {
        active = true;
        renderer.autoClear = false;
        lastTime = performance.now();
        onStart?.();
      },

      onUpdate({ processCpuResult }) {
        const reality = processCpuResult?.reality;
        if (!reality) return;

        // Apply SLAM camera pose
        const { rotation, position, intrinsics } = reality;
        camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        camera.position.set(position.x, position.y, position.z);

        // Sync projection matrix from device camera intrinsics (column-major float32)
        if (intrinsics) {
          camera.projectionMatrix.fromArray(intrinsics);
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }

        const now = performance.now();
        const delta = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        onPerFrame(delta);
      },

      onRender() {
        renderer.clearDepth();
        renderer.render(scene, camera);
      },

      onStop() {
        active = false;
        renderer.autoClear = true;
        onStop?.();
      },
    };
  }

  return {
    isActive: () => active,

    /** Loads 8th Wall (if not yet loaded), stops the caller's animation loop, starts SLAM. */
    start() {
      return new Promise((resolve, reject) => {
        const run = () => {
          try {
            // Stop Three.js RAF before handing control to 8th Wall
            renderer.setAnimationLoop(null);

            XR8.addCameraPipelineModules([
              XR8.GlTextureRenderer.pipelineModule(),
              XR8.XrController.pipelineModule(),
              buildModule(),
            ]);
            XR8.run({ canvas: renderer.domElement });
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        if (window.XR8) {
          run();
          return;
        }

        // Dynamically inject xr.js — it fires 'xrloaded' when ready
        const script = document.createElement("script");
        script.setAttribute("data-preload-chunks", "slam");
        script.src = xrJsPath;
        script.onerror = () => reject(new Error("Failed to load 8th Wall xr.js"));
        document.head.appendChild(script);
        window.addEventListener("xrloaded", run, { once: true });
      });
    },

    stop() {
      if (active && window.XR8) XR8.stop();
    },
  };
}
