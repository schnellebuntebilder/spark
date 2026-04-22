import { SplatEncoding } from './defines';

export type PcSogsJson = {
    means: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    scales: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    quats: {
        shape: number[];
        dtype: string;
        encoding?: string;
        files: string[];
    };
    sh0: {
        shape: number[];
        dtype: string;
        mins: number[];
        maxs: number[];
        files: string[];
    };
    shN?: {
        shape: number[];
        dtype: string;
        mins: number;
        maxs: number;
        quantization: number;
        files: string[];
    };
};
export type PcSogsV2Json = {
    version: 2;
    count: number;
    antialias?: boolean;
    means: {
        mins: number[];
        maxs: number[];
        files: string[];
    };
    scales: {
        codebook: number[];
        files: string[];
    };
    quats: {
        files: string[];
    };
    sh0: {
        codebook: number[];
        files: string[];
    };
    shN?: {
        count: number;
        bands: number;
        codebook: number[];
        files: string[];
    };
};
export declare function isPcSogs(input: ArrayBuffer | Uint8Array | string): boolean;
export declare function tryPcSogs(input: ArrayBuffer | Uint8Array | string): PcSogsJson | PcSogsV2Json | undefined;
export declare function tryPcSogsZip(input: ArrayBuffer | Uint8Array): {
    name: string;
    json: PcSogsJson | PcSogsV2Json;
} | undefined;
export declare function unpackPcSogs(json: PcSogsJson | PcSogsV2Json, extraFiles: Record<string, ArrayBuffer>, splatEncoding: SplatEncoding): Promise<{
    packedArray: Uint32Array;
    numSplats: number;
    extra: Record<string, unknown>;
}>;
export declare function unpackPcSogsZip(fileBytes: Uint8Array, splatEncoding: SplatEncoding): Promise<{
    packedArray: Uint32Array;
    numSplats: number;
    extra: Record<string, unknown>;
}>;
