// Proves a Tint circuit (transact or swap) for the EVM verifier, with noir_js + bb.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Noir } from '@noir-lang/noir_js';
import { Barretenberg, UltraHonkBackend } from '@aztec-foundation/bb.js';

export const circuitPath = (name) =>
  fileURLToPath(new URL(`../../circuits/${name}/target/${name}.json`, import.meta.url));

export class Prover {
  /** @param name 'transact' or 'swap' (built by circuits/build.sh) */
  static async create(name, path = circuitPath(name)) {
    const circuit = JSON.parse(readFileSync(path, 'utf8'));
    const api = await Barretenberg.new();
    return new Prover(circuit, api);
  }

  constructor(circuit, api) {
    this.noir = new Noir(circuit);
    this.backend = new UltraHonkBackend(circuit.bytecode, api);
    this.api = api;
  }

  /** Returns { proof: Uint8Array, publicInputs: string[] }. */
  async prove(circuitInputs) {
    const { witness } = await this.noir.execute(circuitInputs);
    return this.backend.generateProof(witness, { verifierTarget: 'evm' });
  }

  async verify(proofData) {
    return this.backend.verifyProof(proofData, { verifierTarget: 'evm' });
  }

  async destroy() {
    await this.api.destroy();
  }
}
