import { FileLoader, Loader, LoadingManager } from 'three';
import { ExtSplats } from './ExtSplats';
import { PackedSplats } from './PackedSplats';
import { FileInput, SplatData, TranscodeSpzInput, getFileExtension, getSplatFileType, getSplatFileTypeFromPath } from './SplatCore';
import { SplatMesh } from './SplatMesh';
import { SplatEncoding, SplatFileType } from './defines';
import { PcSogsJson, PcSogsV2Json, isPcSogs, tryPcSogs, tryPcSogsZip } from './pcsogs';

export type { FileInput, TranscodeSpzInput };
export { SplatData, getFileExtension, getSplatFileType, getSplatFileTypeFromPath, };
export type { PcSogsJson, PcSogsV2Json };
export { isPcSogs, tryPcSogs, tryPcSogsZip };
export declare class SplatLoader extends Loader {
    fileLoader: FileLoader;
    constructor(manager?: LoadingManager);
    load(url: string, onLoad?: (decoded: PackedSplats | ExtSplats) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<PackedSplats | ExtSplats>;
    parse(packedSplats: PackedSplats): SplatMesh;
    loadInternal({ packedSplats, extSplats, url, fileBytes, fileType, fileName, stream, streamLength, onLoad, onProgress, onError, lod, nonLod, lodAbove, lodBase, }: {
        packedSplats?: PackedSplats;
        extSplats?: ExtSplats;
        url?: string;
        fileBytes?: Uint8Array | ArrayBuffer;
        fileType?: SplatFileType;
        fileName?: string;
        stream?: ReadableStream;
        streamLength?: number;
        onLoad?: (decoded: PackedSplats | ExtSplats) => void;
        onProgress?: (event: ProgressEvent) => void;
        onError?: (error: unknown) => void;
        lod?: boolean | "quality";
        nonLod?: boolean;
        lodAbove?: number;
        lodBase?: number;
    }): void;
    loadInternalAsync({ packedSplats, extSplats, url, fileBytes, fileType, fileName, stream, streamLength, onProgress, lod, nonLod, lodAbove, lodBase, }: {
        packedSplats?: PackedSplats;
        extSplats?: ExtSplats;
        url?: string;
        fileBytes?: Uint8Array | ArrayBuffer;
        fileType?: SplatFileType;
        fileName?: string;
        stream?: ReadableStream;
        streamLength?: number;
        onProgress?: (event: ProgressEvent) => void;
        lod?: boolean;
        nonLod?: boolean;
        lodAbove?: number;
        lodBase?: number;
    }): Promise<unknown>;
}
export declare function unpackSplats({ input, extraFiles, fileType, pathOrUrl, splatEncoding, }: {
    input: Uint8Array | ArrayBuffer;
    extraFiles?: Record<string, ArrayBuffer>;
    fileType?: SplatFileType;
    pathOrUrl?: string;
    splatEncoding?: SplatEncoding;
}): Promise<{
    packedArray: Uint32Array;
    numSplats: number;
    extra?: Record<string, unknown>;
}>;
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    input: TranscodeSpzInput;
    fileBytes: Uint8Array;
}>;
