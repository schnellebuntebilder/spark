import { FileLoader, Loader, type LoadingManager } from "three";
import { ExtSplats, type ExtSplatsOptions } from "./ExtSplats";
import { withWorker } from "./OldSplatWorker";
import { PackedSplats, type PackedSplatsOptions } from "./PackedSplats";
import {
  type FileInput,
  type TranscodeSpzInput,
  SplatData,
  getFileExtension,
  getSplatFileType,
  getSplatFileTypeFromPath,
} from "./SplatCore";
import { SplatMesh } from "./SplatMesh";
import { workerPool } from "./SplatWorker";
import { type SplatEncoding, SplatFileType } from "./defines";
import {
  type PcSogsJson,
  type PcSogsV2Json,
  isPcSogs,
  tryPcSogs,
  tryPcSogsZip,
} from "./pcsogs";
import { PlyReader } from "./ply";
import { getTextureSize } from "./utils";

export type { FileInput, TranscodeSpzInput };
export {
  SplatData,
  getFileExtension,
  getSplatFileType,
  getSplatFileTypeFromPath,
};
export type { PcSogsJson, PcSogsV2Json };
export { isPcSogs, tryPcSogs, tryPcSogsZip };

// SplatLoader implements the THREE.Loader interface and supports loading a variety
// of different Gsplat file formats. Formats .PLY and .SPZ can be auto-detected
// from the file contents, while .SPLAT and .KSPLAT require either having the
// appropriate file extension as part of the path, or it can be explicitly set
// in the loader using the fileType property.

export class SplatLoader extends Loader {
  fileLoader: FileLoader;

  constructor(manager?: LoadingManager) {
    super(manager);
    this.fileLoader = new FileLoader(manager);
  }

  load(
    url: string,
    onLoad?: (decoded: PackedSplats | ExtSplats) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    return this.loadInternal({
      url,
      onLoad,
      onProgress,
      onError,
    });
  }

  async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PackedSplats | ExtSplats> {
    return new Promise((resolve, reject) => {
      this.load(
        url,
        (decoded) => {
          resolve(decoded);
        },
        onProgress,
        reject,
      );
    });
  }

  parse(packedSplats: PackedSplats): SplatMesh {
    return new SplatMesh({ packedSplats });
  }

  loadInternal({
    packedSplats,
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onLoad,
    onProgress,
    onError,
    lod,
    nonLod,
    lodAbove,
    lodBase,
  }: {
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
  }) {
    if (fileBytes instanceof ArrayBuffer) {
      fileBytes = new Uint8Array(fileBytes);
    }
    const resolvedURL = fileBytes
      ? undefined
      : this.manager.resolveURL((this.path ?? "") + (url ?? ""));

    let readStream = stream?.getReader();

    this.manager.itemStart(resolvedURL ?? "");
    // let calledOnLoad = false;

    workerPool
      .withWorker(async (worker) => {
        // If LoD is set and not falsey
        const splatsLod = packedSplats?.lod ?? extSplats?.lod;
        if (splatsLod) {
          lod = splatsLod;
        }
        const splatsNonLod = packedSplats?.nonLod ?? extSplats?.nonLod;
        if (splatsNonLod !== undefined) {
          nonLod = splatsNonLod;
        }

        // let init: {
        //   numSplats: number;
        //   packedArray: Uint32Array;
        //   extra: Record<string, unknown>;
        //   splatEncoding: SplatEncoding;
        // } | null = null;
        // let initExt: {
        //   numSplats: number;
        //   ext0: Uint32Array;
        //   ext1: Uint32Array;
        //   extra: Record<string, unknown>;
        // } | null = null;

        const onStatus = async (data: unknown) => {
          const { loaded, total } = data as { loaded: number; total: number };
          if (loaded !== undefined && onProgress) {
            onProgress(
              new ProgressEvent("progress", {
                lengthComputable: total !== 0,
                loaded,
                total,
              }),
            );
          }

          if ((data as { nextChunk?: boolean }).nextChunk) {
            let chunk: Uint8Array;
            if (!readStream) {
              chunk = new Uint8Array(0);
            } else {
              const { done, value } = await readStream.read();
              if (done) {
                readStream.releaseLock();
                readStream = undefined;
                chunk = new Uint8Array(0);
              } else {
                chunk = value;
              }
            }
            worker.call("nextChunk", { chunk });
          }

          // if ((data as { orig?: unknown }).orig) {
          //   if (extSplats) {
          //     initExt = (data as { orig?: unknown }).orig as {
          //       numSplats: number;
          //       ext0: Uint32Array;
          //       ext1: Uint32Array;
          //       extra: Record<string, unknown>;
          //     };
          //     extSplats.initialize({
          //       numSplats: initExt?.numSplats,
          //       extArrays: [initExt?.ext0, initExt?.ext1],
          //       extra: initExt?.extra,
          //     });
          //     calledOnLoad = true;
          //     onLoad?.(extSplats);
          //   } else if (packedSplats) {
          //     init = (data as { orig?: unknown }).orig as {
          //       numSplats: number;
          //       packedArray: Uint32Array;
          //       extra: Record<string, unknown>;
          //       splatEncoding: SplatEncoding;
          //     };
          //     packedSplats.initialize({
          //       numSplats: init?.numSplats,
          //       packedArray: init?.packedArray,
          //       extra: init?.extra,
          //       splatEncoding: init?.splatEncoding,
          //     });
          //     calledOnLoad = true;
          //     onLoad?.(packedSplats);
          //   } else {
          //     console.warn("No splats to initialize");
          //   }
          // }
        };

        const basedUrl = resolvedURL
          ? new URL(resolvedURL, window.location.href).toString()
          : undefined;
        const decoded = (await worker.call(
          extSplats ? "loadExtSplats" : "loadPackedSplats",
          {
            url: basedUrl,
            requestHeader: this.requestHeader,
            withCredentials: this.withCredentials,
            fileBytes: fileBytes?.slice(),
            fileType,
            pathName: resolvedURL || fileName,
            chunked: stream !== undefined,
            chunkedLength: streamLength,
            encoding: packedSplats?.splatEncoding,
            lod,
            lodBase,
            nonLod,
            lodAbove,
          },
          { onStatus },
        )) as {
          numSplats: number;
          packedArray?: Uint32Array;
          ext0?: Uint32Array;
          ext1?: Uint32Array;
          extra: Record<string, unknown>;
          splatEncoding?: SplatEncoding;
          lodSplats?:
            | {
                numSplats: number;
                packedArray?: Uint32Array;
                ext0?: Uint32Array;
                ext1?: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding?: SplatEncoding;
              }
            | PackedSplats
            | ExtSplats;
        };

        if (decoded.lodSplats) {
          if (extSplats) {
            decoded.lodSplats = new ExtSplats({
              ...(decoded.lodSplats as {
                numSplats: number;
                extArrays: [Uint32Array, Uint32Array];
                extra: Record<string, unknown>;
              }),
            });
          } else {
            decoded.lodSplats = new PackedSplats({
              ...(decoded.lodSplats as {
                numSplats: number;
                packedArray: Uint32Array;
                extra: Record<string, unknown>;
                splatEncoding: SplatEncoding;
              }),
              maxSplats: packedSplats?.maxSplats,
            });
          }
        }

        if (extSplats) {
          const initExtSplats = {
            // ...(initExt ?? {}),
            ...decoded,
          };
          extSplats.initialize(initExtSplats as ExtSplatsOptions);
          // if (!calledOnLoad) {
          onLoad?.(extSplats);
          // }
        } else {
          const initSplats = {
            // ...(init ?? {}),
            ...decoded,
          };
          if (packedSplats) {
            packedSplats.initialize(initSplats as PackedSplatsOptions);
            // if (!calledOnLoad) {
            onLoad?.(packedSplats);
            // }
          } else {
            // if (!calledOnLoad) {
            onLoad?.(new PackedSplats(initSplats as PackedSplatsOptions));
            // }
          }
        }
      })
      .catch((error) => {
        this.manager.itemError(resolvedURL ?? "");
        onError?.(error);
      })
      .finally(() => {
        this.manager.itemEnd(resolvedURL ?? "");
      });
  }

  async loadInternalAsync({
    packedSplats,
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onProgress,
    lod,
    nonLod,
    lodAbove,
    lodBase,
  }: {
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
  }) {
    return new Promise((resolve, reject) => {
      this.loadInternal({
        packedSplats,
        extSplats,
        url,
        fileBytes,
        fileType,
        fileName,
        stream,
        streamLength,
        onLoad: resolve,
        onProgress,
        onError: reject,
        lod,
        nonLod,
        lodAbove,
        lodBase,
      });
    });
  }
}

async function fetchWithProgress(
  request: Request,
  onProgress?: (event: ProgressEvent) => void,
) {
  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(
      `${response.status} "${response.statusText}" fetching URL: ${request.url}`,
    );
  }
  if (!response.body) {
    throw new Error(`Response body is null for URL: ${request.url}`);
  }

  const reader = response.body.getReader();
  let loaded = 0;
  const chunks: Uint8Array[] = [];
  try {
    const contentLength = Number.parseInt(
      response.headers.get("Content-Length") || "0",
    );
    const total = Number.isNaN(contentLength) ? 0 : contentLength;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      loaded += value.length;

      if (onProgress) {
        onProgress(
          new ProgressEvent("progress", {
            lengthComputable: total !== 0,
            loaded,
            total,
          }),
        );
      }
    }
  } catch (err) {
    try {
      const reason = err instanceof Error ? err.message : "Unknown error";
      await reader.cancel(reason);
    } catch {}
    throw err;
  }

  // Combine chunks into a single buffer
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

export async function unpackSplats({
  input,
  extraFiles,
  fileType,
  pathOrUrl,
  splatEncoding,
}: {
  input: Uint8Array | ArrayBuffer;
  extraFiles?: Record<string, ArrayBuffer>;
  fileType?: SplatFileType;
  pathOrUrl?: string;
  splatEncoding?: SplatEncoding;
}): Promise<{
  packedArray: Uint32Array;
  numSplats: number;
  extra?: Record<string, unknown>;
}> {
  const fileBytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let splatFileType = fileType;
  if (!fileType) {
    splatFileType = getSplatFileType(fileBytes);
    if (!splatFileType && pathOrUrl) {
      splatFileType = getSplatFileTypeFromPath(pathOrUrl);
    }
  }

  switch (splatFileType) {
    case SplatFileType.PLY: {
      const ply = new PlyReader({ fileBytes });
      await ply.parseHeader();
      const numSplats = ply.numSplats;
      const maxSplats = getTextureSize(numSplats).maxSplats;
      const args = {
        fileBytes,
        packedArray: new Uint32Array(maxSplats * 4),
        splatEncoding,
      };
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "unpackPly",
          args,
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.SPZ: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodeSpz",
          {
            fileBytes,
            splatEncoding,
          },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.SPLAT: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats } = (await worker.call(
          "decodeAntiSplat",
          {
            fileBytes,
            splatEncoding,
          },
        )) as { packedArray: Uint32Array; numSplats: number };
        return { packedArray, numSplats };
      });
    }
    case SplatFileType.KSPLAT: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodeKsplat",
          { fileBytes, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.PCSOGS: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodePcSogs",
          { fileBytes, extraFiles, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    case SplatFileType.PCSOGSZIP: {
      return await withWorker(async (worker) => {
        const { packedArray, numSplats, extra } = (await worker.call(
          "decodePcSogsZip",
          { fileBytes, splatEncoding },
        )) as {
          packedArray: Uint32Array;
          numSplats: number;
          extra: Record<string, unknown>;
        };
        return { packedArray, numSplats, extra };
      });
    }
    default: {
      throw new Error(`Unknown splat file type: ${splatFileType}`);
    }
  }
}

export async function transcodeSpz(
  input: TranscodeSpzInput,
): Promise<{ input: TranscodeSpzInput; fileBytes: Uint8Array }> {
  return await withWorker(async (worker) => {
    const result = (await worker.call("transcodeSpz", input)) as {
      input: TranscodeSpzInput;
      fileBytes: Uint8Array;
    };
    return result;
  });
}
