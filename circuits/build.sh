#!/usr/bin/env bash
# Compiles every circuit, writes its EVM verification key and its Solidity
# verifier into contracts/src/verifiers/<Name>Verifier.sol.
# Needs nargo 1.0.0 and bb 6.0.0 (noirup, then bbup).
set -euo pipefail
export PATH="$HOME/.bb:$HOME/.nargo/bin:$PATH"
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../contracts/src/verifiers"
mkdir -p "$out"
for c in transact; do
  name="$(echo "${c:0:1}" | tr a-z A-Z)${c:1}Verifier"
  (cd "$here/$c" && nargo compile && bb write_vk -b "target/$c.json" -o target -t evm)
  bb write_solidity_verifier -k "$here/$c/target/vk" -o "$out/$name.sol" -t evm
  # bb names every verifier HonkVerifier; give each its own name.
  sed -i.bak "s/contract HonkVerifier is/contract $name is/" "$out/$name.sol" && rm "$out/$name.sol.bak"
  echo "$c: $(grep -c . "$out/$name.sol") lines -> $name"
done
