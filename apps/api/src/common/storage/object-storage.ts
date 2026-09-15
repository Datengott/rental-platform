import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

// R2 credentials are still blank in .env.example (see CLAUDE.md's "flag it
// to the human" list is about payments/notices/e-signature, but bucket
// wiring is equally unset — flagging here rather than guessing credentials).
// This dev-only implementation writes to local disk so upload flows are
// testable end-to-end; swap for a real R2 client once credentials exist.
// Callers only depend on the interface below, so nothing else changes.
export interface ObjectStorage {
  upload(folder: string, buffer: Buffer, originalName: string): Promise<string>;
}

const LOCAL_UPLOAD_ROOT = join(process.cwd(), 'uploads');

@Injectable()
export class LocalDiskObjectStorage implements ObjectStorage {
  async upload(folder: string, buffer: Buffer, originalName: string): Promise<string> {
    const dir = join(LOCAL_UPLOAD_ROOT, folder);
    await mkdir(dir, { recursive: true });
    const extension = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const fileName = `${randomUUID()}.${extension}`;
    await writeFile(join(dir, fileName), buffer);
    return `local://${folder}/${fileName}`;
  }
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
