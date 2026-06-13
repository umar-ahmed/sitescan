export const DEFAULT_WALRUS_PUBLISHER =
  "https://publisher.walrus-testnet.walrus.space";
export const DEFAULT_WALRUS_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";

export function walrusAggregatorUrl(
  blobId: string,
  aggregator: string = DEFAULT_WALRUS_AGGREGATOR,
): string {
  return `${aggregator}/v1/blobs/${blobId}`;
}

export interface UploadOptions {
  publisher?: string;
  epochs?: number;
  contentType?: string;
  timeoutMs?: number;
}

// Upload bytes to a Walrus publisher and return the blob id.
export async function uploadToWalrus(
  data: Uint8Array | ArrayBuffer | Blob | string,
  options: UploadOptions = {},
): Promise<string> {
  const publisher = options.publisher ?? DEFAULT_WALRUS_PUBLISHER;
  const epochs = options.epochs ?? 1;
  const body =
    typeof data === "string" || data instanceof Blob
      ? data
      : new Blob([new Uint8Array(data)]);
  const res = await fetch(`${publisher}/v1/blobs?epochs=${epochs}`, {
    method: "PUT",
    headers: options.contentType
      ? { "Content-Type": options.contentType }
      : undefined,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
  });
  if (!res.ok) {
    throw new Error(`Walrus upload failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const blobId =
    json?.newlyCreated?.blobObject?.blobId ?? json?.alreadyCertified?.blobId;
  if (!blobId) {
    throw new Error("No blobId in Walrus response: " + JSON.stringify(json));
  }
  return blobId;
}
