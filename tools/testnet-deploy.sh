#!/usr/bin/env bash
# Deploys Tint to Robinhood Chain testnet (chain 46630):
#   1. TestUSDG and a full-range tUSDG/stock "test pool" on the testnet's Uniswap v3
#      for each of Robinhood's test stock tokens the deployer holds (SeedTestnet.s.sol)
#   2. the verifiers, pool and tree, listing tUSDG and those stocks (Deploy.s.sol)
#   3. source verification on the testnet explorer (Blockscout)
# and writes contracts/deployments/46630.json (+ a copy for the web app).
#
#   DEPLOYER_KEY=0x… ./tools/testnet-deploy.sh
#
# The deployer needs testnet ETH and the stock tokens from
# https://faucet.testnet.chain.robinhood.com. FORK=1 runs the same steps against
# a local anvil fork of testnet (RPC=http://127.0.0.1:8546), funding an anvil key.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/../contracts"

RPC=${RPC:-https://rpc.testnet.chain.robinhood.com}
EXPLORER=https://explorer.testnet.chain.robinhood.com
# Uniswap v3 on Robinhood Chain testnet (verified on the explorer)
FACTORY=0xdf9e3D6ffaC4513dD7b053212bbECcbCD15ec932
NPM=0xFFe6CFc4f759b65f9B62c9D05A9E21a78cE93e12
QUOTER=0xDDcBe4989C8171F721c5e683C9C6339B59718213
# Robinhood's test stock tokens, and the price each test pool opens at, in tUSDG
# (6 decimals). TSLA and AMZN: Robinhood Chain mainnet Uniswap prices on Nov 18 2026.
# AMD, PLTR and NFLX have no mainnet pool, so their prices are set by hand.
SYMBOLS=(TSLA AMZN AMD PLTR NFLX)
TOKENS=(0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02 0x71178BAc73cBeb415514eB542a8995b82669778d 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93)
PRICES=(382000000 266000000 240000000 180000000 110000000)

[ "$(cast chain-id --rpc-url "$RPC")" = "46630" ] || { echo "RPC is not Robinhood Chain testnet (46630)"; exit 1; }

if [ "${FORK:-}" = "1" ]; then
  DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil key 0, fork only
  ME=$(cast wallet address --private-key $DEPLOYER_KEY)
  cast rpc anvil_setBalance "$ME" 0x8AC7230489E80000 --rpc-url "$RPC" >/dev/null
  for t in "${TOKENS[@]}"; do # 5 shares each, like the faucet
    SLOT=$(TOKEN=$t HOLDER=$ME forge script script/BalanceSlot.s.sol --rpc-url "$RPC" 2>/dev/null | grep -oE '0x[0-9a-f]{64}' | tail -1)
    cast rpc anvil_setStorageAt "$t" "$SLOT" "$(cast to-uint256 5000000000000000000)" --rpc-url "$RPC" >/dev/null
  done
fi
: "${DEPLOYER_KEY:?set DEPLOYER_KEY}"
ME=$(cast wallet address --private-key "$DEPLOYER_KEY")
echo "deployer $ME: $(cast balance "$ME" --ether --rpc-url "$RPC") ETH"

# Seed only the stocks the deployer holds.
S_TOKENS=() S_PRICES=() S_SHARES=() S_SYMBOLS=()
for i in "${!TOKENS[@]}"; do
  bal=$(cast call "${TOKENS[$i]}" 'balanceOf(address)(uint256)' "$ME" --rpc-url "$RPC" | awk '{print $1}')
  echo "  ${SYMBOLS[$i]}: $bal"
  if [ "$bal" != "0" ]; then S_TOKENS+=("${TOKENS[$i]}"); S_PRICES+=("${PRICES[$i]}"); S_SHARES+=("$bal"); S_SYMBOLS+=("${SYMBOLS[$i]}"); fi
done
[ ${#S_TOKENS[@]} -gt 0 ] || { echo "the deployer holds no test stock tokens: get them from the faucet first"; exit 1; }
join() { local IFS=,; echo "$*"; }

VERIFY=()
[ "${FORK:-}" = "1" ] || VERIFY=(--verify --verifier blockscout --verifier-url "$EXPLORER/api/")

START=$(cast block-number --rpc-url "$RPC")
NPM=$NPM STOCKS=$(join "${S_TOKENS[@]}") PRICES=$(join "${S_PRICES[@]}") SHARES=$(join "${S_SHARES[@]}") USDG=${USDG:-} \
  forge script script/SeedTestnet.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast --slow -q ${VERIFY[@]+"${VERIFY[@]}"}
USDG=$(python3 -c "import json; print(json.load(open('deployments/46630-seed.json'))['usdg'])")

# Caps: 1,000 tUSDG per deposit, 100,000 in the pool; 10 / 1,000 shares per stock.
N=${#S_TOKENS[@]}
MAXD=1000000000 MAXP=100000000000
for _ in $(seq "$N"); do MAXD="$MAXD,10000000000000000000"; MAXP="$MAXP,1000000000000000000000"; done
UNISWAP_FACTORY=$FACTORY ASSETS=$USDG,$(join "${S_TOKENS[@]}") MAX_DEPOSITS=$MAXD MAX_POOL=$MAXP \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast --slow -q ${VERIFY[@]+"${VERIFY[@]}"}

python3 - "$START" "$RPC" "$QUOTER" "$NPM" "$EXPLORER" "$USDG" "$(join "${S_SYMBOLS[@]}")" "$(join "${S_TOKENS[@]}")" <<'PY'
import json, sys
start, rpc, quoter, npm, explorer, usdg, syms, toks = sys.argv[1:]
d = json.load(open('deployments/46630.json'))
seed = json.load(open('deployments/46630-seed.json'))
d.update(startBlock=int(start), rpc=rpc,
         quoter=quoter, positionManager=npm, explorer=explorer, testPools=seed['pools'],
         assets=[{'symbol': 'USDG', 'address': usdg, 'decimals': 6, 'cash': True, 'name': 'Tint Test USDG'}] +
                [{'symbol': s, 'address': t, 'decimals': 18} for s, t in zip(syms.split(','), toks.split(','))])
json.dump(d, open('deployments/46630.json', 'w'), indent=2)
print(json.dumps(d, indent=2))
PY
mkdir -p ../web/src/deployments && cp deployments/46630.json ../web/src/deployments/46630.json
