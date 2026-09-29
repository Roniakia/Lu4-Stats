import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const MW2_BASE_URL = (process.env.MW2_BASE_URL ?? 'https://mw2.global').replace(/\/+$/, '');
export const MW2_USER_AGENT = process.env.MW2_USER_AGENT
  ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 mw2-lu4-pvp-service';
