import { SplatFileType } from './defines';

export type FileInput = {
    fileBytes: Uint8Array;
    fileType?: SplatFileType;
    pathOrUrl?: string;
    transform?: {
        translate?: number[];
        quaternion?: number[];
        scale?: number;
    };
};
export type TranscodeSpzInput = {
    inputs: FileInput[];
    maxSh?: number;
    clipXyz?: {
        min: number[];
        max: number[];
    };
    fractionalBits?: number;
    opacityThreshold?: number;
};
export declare function getFileExtension(pathOrUrl: string): string;
export declare function getSplatFileType(fileBytes: Uint8Array): SplatFileType | undefined;
export declare function getSplatFileTypeFromPath(pathOrUrl: string): SplatFileType | undefined;
export declare class SplatData {
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
    constructor({ maxSplats }?: {
        maxSplats?: number;
    });
    pushSplat(): number;
    unpushSplat(index: number): void;
    ensureCapacity(numSplats: number): void;
    ensureIndex(index: number): void;
    setCenter(index: number, x: number, y: number, z: number): void;
    setScale(index: number, scaleX: number, scaleY: number, scaleZ: number): void;
    setQuaternion(index: number, x: number, y: number, z: number, w: number): void;
    setOpacity(index: number, opacity: number): void;
    setColor(index: number, r: number, g: number, b: number): void;
    setSh1(index: number, sh1: Float32Array): void;
    setSh2(index: number, sh2: Float32Array): void;
    setSh3(index: number, sh3: Float32Array): void;
}
