import { SplatFileType } from "./defines";
import { tryPcSogsZip } from "./pcsogs";
import { decompressPartialGzip, getTextureSize } from "./utils";

export type FileInput = {
  fileBytes: Uint8Array;
  fileType?: SplatFileType;
  pathOrUrl?: string;
  transform?: { translate?: number[]; quaternion?: number[]; scale?: number };
};

export type TranscodeSpzInput = {
  inputs: FileInput[];
  maxSh?: number;
  clipXyz?: { min: number[]; max: number[] };
  fractionalBits?: number;
  opacityThreshold?: number;
};

// Returns the lowercased file extension from a path or URL
export function getFileExtension(pathOrUrl: string): string {
  const noTrailing = pathOrUrl.split(/[?#]/, 1)[0];
  const lastSlash = Math.max(
    noTrailing.lastIndexOf("/"),
    noTrailing.lastIndexOf("\\"),
  );
  const filename = noTrailing.slice(lastSlash + 1);
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return ""; // No extension
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

export function getSplatFileType(
  fileBytes: Uint8Array,
): SplatFileType | undefined {
  const view = new DataView(fileBytes.buffer);
  const magic = view.getUint32(0, true);
  if ((magic & 0x00ffffff) === 0x00796c70) {
    return SplatFileType.PLY;
  }
  if ((magic & 0x00ffffff) === 0x00088b1f) {
    // Gzipped file, unpack beginning to check magic number
    const header = decompressPartialGzip(fileBytes, 4);
    const gView = new DataView(header.buffer);
    if (gView.getUint32(0, true) === 0x5053474e) {
      return SplatFileType.SPZ;
    }
    // Unknown Gzipped file type
    return undefined;
  }
  if (magic === 0x04034b50) {
    // PKZip file
    if (tryPcSogsZip(fileBytes)) {
      return SplatFileType.PCSOGSZIP;
    }
    // Unknown PKZip file type
    return undefined;
  }
  if (magic === 0x30444152) {
    return SplatFileType.RAD;
  }
  // Unknown file type
  return undefined;
}

export function getSplatFileTypeFromPath(
  pathOrUrl: string,
): SplatFileType | undefined {
  const extension = getFileExtension(pathOrUrl);
  if (extension === "ply") {
    return SplatFileType.PLY;
  }
  if (extension === "spz") {
    return SplatFileType.SPZ;
  }
  if (extension === "splat") {
    return SplatFileType.SPLAT;
  }
  if (extension === "ksplat") {
    return SplatFileType.KSPLAT;
  }
  if (extension === "sog") {
    return SplatFileType.PCSOGSZIP;
  }
  if (extension === "rad") {
    return SplatFileType.RAD;
  }
  return undefined;
}

export class SplatData {
  numSplats: number;
  maxSplats: number;
  centers: Float32Array;
  scales: Float32Array;
  quaternions: Float32Array;
  opacities: Float32Array;
  colors: Float32Array;
  sh1?: Float32Array;
  sh2?: Float32Array;
  sh3?: Float32Array;

  constructor({ maxSplats = 1 }: { maxSplats?: number } = {}) {
    this.numSplats = 0;
    this.maxSplats = getTextureSize(maxSplats).maxSplats;
    this.centers = new Float32Array(this.maxSplats * 3);
    this.scales = new Float32Array(this.maxSplats * 3);
    this.quaternions = new Float32Array(this.maxSplats * 4);
    this.opacities = new Float32Array(this.maxSplats);
    this.colors = new Float32Array(this.maxSplats * 3);
  }

  pushSplat(): number {
    const index = this.numSplats;
    this.ensureIndex(index);
    this.numSplats += 1;
    return index;
  }

  unpushSplat(index: number) {
    if (index === this.numSplats - 1) {
      this.numSplats -= 1;
    } else {
      throw new Error("Cannot unpush splat from non-last position");
    }
  }

  ensureCapacity(numSplats: number) {
    if (numSplats > this.maxSplats) {
      const targetSplats = Math.max(numSplats, this.maxSplats * 2);
      const newCenters = new Float32Array(targetSplats * 3);
      const newScales = new Float32Array(targetSplats * 3);
      const newQuaternions = new Float32Array(targetSplats * 4);
      const newOpacities = new Float32Array(targetSplats);
      const newColors = new Float32Array(targetSplats * 3);
      newCenters.set(this.centers);
      newScales.set(this.scales);
      newQuaternions.set(this.quaternions);
      newOpacities.set(this.opacities);
      newColors.set(this.colors);
      this.centers = newCenters;
      this.scales = newScales;
      this.quaternions = newQuaternions;
      this.opacities = newOpacities;
      this.colors = newColors;

      if (this.sh1) {
        const newSh1 = new Float32Array(targetSplats * 9);
        newSh1.set(this.sh1);
        this.sh1 = newSh1;
      }
      if (this.sh2) {
        const newSh2 = new Float32Array(targetSplats * 15);
        newSh2.set(this.sh2);
        this.sh2 = newSh2;
      }
      if (this.sh3) {
        const newSh3 = new Float32Array(targetSplats * 21);
        newSh3.set(this.sh3);
        this.sh3 = newSh3;
      }

      this.maxSplats = targetSplats;
    }
  }

  ensureIndex(index: number) {
    this.ensureCapacity(index + 1);
  }

  setCenter(index: number, x: number, y: number, z: number) {
    this.centers[index * 3] = x;
    this.centers[index * 3 + 1] = y;
    this.centers[index * 3 + 2] = z;
  }

  setScale(index: number, scaleX: number, scaleY: number, scaleZ: number) {
    this.scales[index * 3] = scaleX;
    this.scales[index * 3 + 1] = scaleY;
    this.scales[index * 3 + 2] = scaleZ;
  }

  setQuaternion(index: number, x: number, y: number, z: number, w: number) {
    this.quaternions[index * 4] = x;
    this.quaternions[index * 4 + 1] = y;
    this.quaternions[index * 4 + 2] = z;
    this.quaternions[index * 4 + 3] = w;
  }

  setOpacity(index: number, opacity: number) {
    this.opacities[index] = opacity;
  }

  setColor(index: number, r: number, g: number, b: number) {
    this.colors[index * 3] = r;
    this.colors[index * 3 + 1] = g;
    this.colors[index * 3 + 2] = b;
  }

  setSh1(index: number, sh1: Float32Array) {
    if (!this.sh1) {
      this.sh1 = new Float32Array(this.maxSplats * 9);
    }
    for (let j = 0; j < 9; ++j) {
      this.sh1[index * 9 + j] = sh1[j];
    }
  }

  setSh2(index: number, sh2: Float32Array) {
    if (!this.sh2) {
      this.sh2 = new Float32Array(this.maxSplats * 15);
    }
    for (let j = 0; j < 15; ++j) {
      this.sh2[index * 15 + j] = sh2[j];
    }
  }

  setSh3(index: number, sh3: Float32Array) {
    if (!this.sh3) {
      this.sh3 = new Float32Array(this.maxSplats * 21);
    }
    for (let j = 0; j < 21; ++j) {
      this.sh3[index * 21 + j] = sh3[j];
    }
  }
}
