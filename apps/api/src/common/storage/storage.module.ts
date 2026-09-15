import { Global, Module } from '@nestjs/common';
import { LocalDiskObjectStorage, OBJECT_STORAGE } from './object-storage';

// Global for the same reason as PrismaModule — every module that handles
// file uploads (Auth's KYC docs, Properties' unit photos, ...) needs this,
// and re-providing it per-module would just create redundant instances.
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: LocalDiskObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
