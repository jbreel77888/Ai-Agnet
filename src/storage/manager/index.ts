/**
 * Storage Manager — file storage abstraction (local filesystem)
 * Ready for S3/R2 upgrade by implementing the same interface
 */
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const STORAGE_DIR = process.env.STORAGE_LOCAL_PATH || './storage';

export interface StorageManager {
  upload(opts: UploadOpts): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<StoredObject[]>;
}

export interface UploadOpts {
  key: string;
  data: Buffer | string;
  contentType?: string;
  ownerId?: string;
  isPublic?: boolean;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  contentType?: string;
  createdAt: Date;
}

class LocalStorageManager implements StorageManager {
  async ensureDir() {
    if (!existsSync(STORAGE_DIR)) await fs.mkdir(STORAGE_DIR, { recursive: true });
  }

  async upload(opts: UploadOpts): Promise<StoredObject> {
    await this.ensureDir();
    const filePath = path.join(STORAGE_DIR, opts.key.replace(/\.\.\//g, ''));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const data = typeof opts.data === 'string' ? Buffer.from(opts.data) : opts.data;
    await fs.writeFile(filePath, data);
    return {
      key: opts.key,
      sizeBytes: data.length,
      contentType: opts.contentType,
      createdAt: new Date(),
    };
  }

  async download(key: string): Promise<Buffer> {
    const filePath = path.join(STORAGE_DIR, key.replace(/\.\.\//g, ''));
    return await fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(STORAGE_DIR, key.replace(/\.\.\//g, ''));
    try { await fs.unlink(filePath); } catch {}
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(STORAGE_DIR, key.replace(/\.\.\//g, ''));
    return existsSync(filePath);
  }

  async list(prefix?: string): Promise<StoredObject[]> {
    await this.ensureDir();
    try {
      const entries = await fs.readdir(STORAGE_DIR, { withFileTypes: true });
      return entries
        .filter(e => e.isFile())
        .filter(e => !prefix || e.name.startsWith(prefix))
        .map(e => ({ key: e.name, sizeBytes: 0, createdAt: new Date() }));
    } catch { return []; }
  }
}

let instance: StorageManager | null = null;
export function getStorageManager(): StorageManager {
  if (!instance) instance = new LocalStorageManager();
  return instance;
}
