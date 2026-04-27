import { SparkControls } from "@sparkjsdev/spark";

/**
 * Desktop web controller: mouse-look + WASD via SparkControls.
 * @param {{ renderer, localFrame }} opts
 * @returns {{ update(): void }}
 */
export function createWebController({ renderer, localFrame }) {
  const controls = new SparkControls({ renderer, canvas: renderer.domElement });

  return {
    update() {
      controls.update(localFrame);
    },
  };
}
