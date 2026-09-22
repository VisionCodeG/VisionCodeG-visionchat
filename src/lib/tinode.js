import { Tinode } from 'tinode-sdk';

const runtimeParams =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

const envHost = import.meta.env.VITE_TINODE_HOST || 'localhost:6060';
const envSecure = String(import.meta.env.VITE_TINODE_SECURE || 'false').toLowerCase() === 'true';

const host = runtimeParams.get('tinode') || envHost;
const secureParam = runtimeParams.get('secure');
const secure = secureParam == null
  ? envSecure
  : ['1', 'true', 'yes'].includes(String(secureParam).toLowerCase());

const apiKey = import.meta.env.VITE_TINODE_API_KEY || '';
const mediaBase = import.meta.env.VITE_TINODE_MEDIA_BASE || '';

export function createTinodeClient() {
  return new Tinode({
    appName: 'VisionChat/0.3',
    host,
    apiKey,
    transport: 'ws',
    secure,
    persist: true,
  });
}

export const tinodeConfig = {
  host,
  secure,
  apiKey,
  mediaBase,
  httpBase: `${secure ? 'https' : 'http'}://${host}`,
};
