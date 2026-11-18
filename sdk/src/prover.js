// Proves a Tint circuit (transact or swap) for the EVM verifier, with noir_js +
// bb.js. Works in Node and in the browser (pass the compiled circuit JSON).
import { Noir } from '@noir-lang/noir_js';
import { Barretenberg, UltraHonkBackend } from '@aztec-foundation/bb.js';

export class Prover {
  /** @param circuit compiled circuit JSON (circuits/<name>/target/<name>.json) */
  static async create(circuit, bbOptions) {
    const api = await Barretenberg.new(bbOptions);
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
