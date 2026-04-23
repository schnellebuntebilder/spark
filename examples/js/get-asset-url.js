export async function getAssetFileURL(assetFile) {
  try {
    const response = await fetch("../assets.json");
    const assetsDirectory = "/examples/assets/";
    const assetsInfo = await response.json();
    return `${assetsDirectory}${assetsInfo[assetFile].directory}/${assetFile}`;
  } catch (error) {
    console.error("Failed to load asset file URL:", error);
    return null;
  }
}
