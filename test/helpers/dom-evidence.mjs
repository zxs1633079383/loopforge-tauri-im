import fs from 'node:fs';
import path from 'node:path';

export function evidencePath(name, suffix) {
  const outDir = process.env.LOOPFORGE_EVIDENCE_DIR || '/tmp/loopforge/evidence';
  fs.mkdirSync(outDir, { recursive: true });
  return path.join(outDir, `${name}.${suffix}.json`);
}

export async function captureDomEvidence(browser, name, selectors) {
  const snapshot = await browser.execute((entries) => {
    const readNode = (selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      return nodes.map((node) => ({
        selector,
        text: node.textContent?.trim() || '',
        attrs: Object.fromEntries([...node.attributes].map((attr) => [attr.name, attr.value])),
      }));
    };
    return {
      location: window.location.href,
      ready: document.querySelector('[data-ready]')?.getAttribute('data-ready') || null,
      activeChannel:
        document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel') ||
        null,
      selectors: Object.fromEntries(entries.map((selector) => [selector, readNode(selector)])),
    };
  }, selectors);
  const file = evidencePath(name, 'dom');
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}
