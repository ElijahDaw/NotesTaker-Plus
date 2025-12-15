/// <reference types="vite/client" />

import type { NoteBridge } from './types/note';

declare global {
  interface Window {
    noteBridge?: NoteBridge;
  }
}

export {};
