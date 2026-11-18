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

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

async function relayerGet(url, path) {
  const r = await fetch(url + path);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `Relayer error ${r.status}`);
  return body;
}

/** { relayer, chainId, pool, feeUsd } or null if no relayer answers. */
export async function relayerInfo(net) {
  if (!net.relayer) return null;
  try {
    const info = await relayerGet(net.relayer, '/info');
    return info.chainId === net.id && info.pool.toLowerCase() === net.pool.toLowerCase() ? { ...info, url: net.relayer } : null;
  } catch {
    return null;
  }
}

export const relayerFee = async (relayer, asset) => BigInt((await relayerGet(relayer.url, `/fee?asset=${asset}`)).fee);

/**
 * @param relayer  from relayerInfo(): send through it instead of the user's wallet
 * @param step     callback(stage, detail) — stages: approve, prove, sign | relay, mine, done
 */
export async function runAction({ net, walletClient, account, action, step, relayer }) {
  const t0 = performance.now();
  step('prove');
  const prover = await loadProver(action.circuit);
  const { proof } = await prover.prove(action.circuitInputs);
  const proveMs = Math.round(performance.now() - t0);
  let hash;
  if (relayer) {
    step('relay', { proveMs });
    const [p, ext] = callArgs(action, proof);
    const r = await fetch(relayer.url + '/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ functionName: action.functionName, p, ext }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? `Relayer error ${r.status}`);
    hash = body.hash;
  } else {
    step('sign', { proveMs });
    hash = await walletClient.writeContract({
      account,
      chain: net.chain,
      address: net.pool,
      abi: tintPoolAbi,
      functionName: action.functionName,
      args: callArgs(action, proof),
    });
  }
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
