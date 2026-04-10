import { Module, Global } from '@nestjs/common';
import { createStorage, type Storage } from '@jarvis/storage';
import { resolve } from 'node:path';

export const STORAGE_TOKEN = 'JARVIS_STORAGE';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_TOKEN,
      useFactory: (): Storage => {
        const dbPath = process.env['JARVIS_DB_PATH'] ?? resolve(process.cwd(), 'data', 'jarvis.db');
        return createStorage(dbPath);
      },
    },
  ],
  exports: [STORAGE_TOKEN],
})
export class StorageModule {}
