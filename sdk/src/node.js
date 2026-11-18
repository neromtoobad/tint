// Node-only helpers: load compiled circuits from circuits/<name>/target.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Prover } from './prover.js';

export const circuitPath = (name) =>
  fileURLToPath(new URL(`../../circuits/${name}/target/${name}.json`, import.meta.url));

export const loadCircuit = (name) => JSON.parse(readFileSync(circuitPath(name), 'utf8'));

export const proverFor = (name) => Prover.create(loadCircuit(name));
