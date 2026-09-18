import type { SevenvidApi } from '@sevenvid/ipc';

declare global {
  interface Window {
    sevenvid?: SevenvidApi;
  }
}

export {};
