/**
 * Storage Manager interface
 */
export interface StorageManager {
  upload(opts: UploadOpts): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;
  list(prefix?: string, opts?: ListOpts): Promise<StoredObject[]>;
  getMetadata(key: string): Promise<StoredObject | undefined>;
}

export interface UploadOpts {
  key: string;
  data: Buffer | string | ReadableStream;
  contentType?: string;
  metadata?: Record<string, unknown>;
  isPublic?: boolean;
  ownerId?: string;
}

export interface StoredObject {
  id: string;
  key: string;
  bucket: string;
  backend: 'local' | 's3' | 'r2' | 'gcs';
  contentType?: string;
  sizeBytes: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListOpts {
  limit?: number;
  continuationToken?: string;
}
