import fs from 'node:fs';
import { captureDomEvidence, evidencePath } from './dom-evidence.mjs';

export { captureDomEvidence };

export function captureObserverEvidence(name, evidence) {
  const file = evidencePath(name, 'observer');
  fs.writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), ...evidence }, null, 2));
  return file;
}
