import { firebaseBridge } from './firebase-sync.ts';

declare global {
  interface Window {
    FirebaseBridge: typeof firebaseBridge;
  }
}

window.FirebaseBridge = firebaseBridge;
window.dispatchEvent(new CustomEvent('babyluc:firebase-ready'));
