import * as THREE from "three";

/**
 * Creates a 3D FPS + FOV HUD attached to the given camera.
 * Toggle visibility with the B button; adjust FOV with left controller triggers.
 *
 * @param {THREE.Camera} camera
 * @param {{ getExtra?: () => string }} [opts]
 *   `getExtra` — optional callback returning a string rendered below the FPS line.
 *   When provided, replaces the default "FOV xx°" line.
 * @returns {{
 *   hudMesh: THREE.Mesh,
 *   update: (delta: number, buttons?: { fovPlus?: boolean, fovMinus?: boolean, bPressed?: boolean }) => void
 * }}
 */
export function createHud(camera, { getExtra } = {}) {
  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 256;
  hudCanvas.height = 128;
  const hudCtx = hudCanvas.getContext("2d");
  const hudTex = new THREE.CanvasTexture(hudCanvas);

  const hudMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false }),
  );
  hudMesh.renderOrder = 999;
  hudMesh.position.set(0.14, -0.10, -0.28);
  hudMesh.visible = false;
  camera.add(hudMesh);

  let fpsCount = 0, fpsTime = 0, fpsValue = 0;

  function drawHud() {
    const w = hudCanvas.width, h = hudCanvas.height;
    hudCtx.clearRect(0, 0, w, h);
    hudCtx.fillStyle = "rgba(0,0,0,0.75)";
    hudCtx.beginPath();
    hudCtx.roundRect(4, 4, w - 8, h - 8, 16);
    hudCtx.fill();

    // FPS (large, colour-coded)
    hudCtx.fillStyle = fpsValue >= 60 ? "#00ff88" : fpsValue >= 30 ? "#ffcc00" : "#ff4444";
    hudCtx.font = "bold 62px monospace";
    hudCtx.textAlign = "center";
    hudCtx.fillText(`${fpsValue} FPS`, w / 2, 72);

    // Second line: custom extra text or default FOV
    hudCtx.fillStyle = "#cccccc";
    hudCtx.font = "26px sans-serif";
    const extraLine = getExtra ? getExtra() : `FOV  ${Math.round(camera.fov)}°`;
    hudCtx.fillText(extraLine, w / 2, 112);

    hudTex.needsUpdate = true;
  }

  const FOV_MIN = 40, FOV_MAX = 120;
  let fovCooldown = 0;
  let bWasPressed = false;

  /**
   * Call once per frame inside the animation loop.
   * @param {number} delta - seconds since last frame
   * @param {{ fovPlus?: boolean, fovMinus?: boolean, bPressed?: boolean }} buttons
   */
  function update(delta, { fovPlus = false, fovMinus = false, bPressed = false } = {}) {
    // FOV adjustment — continuous while held, 80 ms between steps
    fovCooldown = Math.max(0, fovCooldown - delta);
    if ((fovPlus || fovMinus) && fovCooldown <= 0) {
      camera.fov = THREE.MathUtils.clamp(
        camera.fov + (fovPlus ? 1 : -1),
        FOV_MIN, FOV_MAX,
      );
      camera.updateProjectionMatrix();
      fovCooldown = 0.08;
      fpsTime = 999; // force immediate HUD refresh so the new FOV shows right away
    }

    // B button: toggle HUD visibility (rising edge only)
    if (bPressed && !bWasPressed) hudMesh.visible = !hudMesh.visible;
    bWasPressed = bPressed;

    if (!hudMesh.visible) return;

    // Update FPS counter at 4× per second
    fpsCount++;
    fpsTime += delta;
    if (fpsTime < 0.25) return;
    fpsValue = Math.round(fpsCount / fpsTime);
    fpsCount = 0;
    fpsTime = 0;
    drawHud();
  }

  return { hudMesh, update };
}
