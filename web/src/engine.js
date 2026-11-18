// Runs one wallet action end to end: build → prove in this browser → send → wait.
import { Prover, callArgs, erc20Abi, tintPoolAbi } from '@tint/sdk';

const provers = {};

function loadProver(name) {
  provers[name] ??= fetch(`/circuits/${name}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the ${name} circuit`);
      return r.json();
    })
    .then((circuit) => Prover.create(circuit));
  return provers[name];
}

/** Start loading both circuits early so the first proof is quicker. */
export const warmProvers = () => Promise.all([loadProver('transact'), loadProver('swap')]);

/**
 * @param step  callback(stage, detail) — stages: approve, prove, sign, mine, done
 */
export async function runAction({ net, walletClient, account, action, step }) {
  const t0 = performance.now();
  step('prove');
  const prover = await loadProver(action.circuit);
  const { proof } = await prover.prove(action.circuitInputs);
  const proveMs = Math.round(performance.now() - t0);
  step('sign', { proveMs });
  const hash = await walletClient.writeContract({
    account,
    chain: net.chain,
    address: net.pool,
    abi: tintPoolAbi,
    functionName: action.functionName,
    args: callArgs(action, proof),
  });
  step('mine', { proveMs, hash });
  const receipt = await net.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The transaction reverted.');
  step('done', { proveMs, hash, gas: receipt.gasUsed });
  return { hash, receipt, proveMs };
}

/** Deposits pull tokens with transferFrom; approve first if needed. */
export async function ensureAllowance({ net, walletClient, account, token, amount, step }) {
  const have = await net.client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address ?? account, net.pool] });
  if (have >= amount) return;
  step('approve');
  const hash = await walletClient.writeContract({
    account,
    chain: net.chain,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [net.pool, amount], // exact amount, no open-ended allowance
  });
  await net.client.waitForTransactionReceipt({ hash });
}

export const tokenBalance = (net, token, owner) =>
  net.client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
