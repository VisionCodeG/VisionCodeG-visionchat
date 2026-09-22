import { Tinode } from 'tinode-sdk';

const host = import.meta.env.VITE_TINODE_HOST || 'localhost:6060';
const secure = String(import.meta.env.VITE_TINODE_SECURE || 'false').toLowerCase() === 'true';
const apiKey =
  import.meta.env.VITE_TINODE_API_KEY ||
  'AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K';

export function createTinodeClient() {
  return new Tinode({
    appName: 'VisionChat/0.2',
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
  httpBase: `${secure ? 'https' : 'http'}://${host}`,
};
