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

/**
 * Creates the Settings GUI panel with LoD and coloring controls plus a live splat counter.
 *
 * @param {{
 *   spark: object,
 *   world: object,
 *   splatColoring: object,
 *   frustumSettings: { sortClipXY: number },
 *   onSplatUpdate: () => void,
 *   onSortClipXYChange: (v: number) => void
 * }} options
 * @returns {{ gui: GUI, debugInfo: { splatCount: number } }}
 */
export function createGui({ spark, world, splatColoring, frustumSettings, onSplatUpdate, onSortClipXYChange }) {
  const gui = new GUI({ title: "Settings" });
  gui.add(world, "enableLod").name("Enable LoD").onChange(onSplatUpdate);
  gui.add(spark, "lodSplatCount", 10000, 250000, 10000).name("LoD splat count");

  const frustum = { clipXY: spark.clipXY };
  gui.add(frustum, "clipXY", 0.5, 3.0, 0.05).name("Frustum size (clipXY)").onChange(v => { spark.clipXY = v; });

  if (frustumSettings) {
    gui.add(frustumSettings, "sortClipXY", 0.5, 3.0, 0.05)
      .name("Sort frustum (CPU cull)")
      .onChange(v => onSortClipXYChange?.(v));
  }

  gui.add(splatColoring, "value").name("Splat index coloring").onChange(onSplatUpdate);

  const debugInfo = { splatCount: 0 };
  gui.add(debugInfo, "splatCount").name("Sorted splats (CPU)").listen().disable();

  return { gui, debugInfo };
}
