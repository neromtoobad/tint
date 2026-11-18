#!/usr/bin/env bash
# Local dev chain: a fork of Robinhood Chain mainnet (real USDG, stock tokens and
# Uniswap pools) running in anvil as chain 31337, with Tint deployed and a test
# account funded with USDG. Fake money only; nothing touches mainnet.
#
#   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 31337   (in another terminal)
#   ./tools/dev-fork.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
RPC=${RPC:-http://127.0.0.1:8545}
# anvil's well-known test keys (public, local only)
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
USER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
TSLA=0x322F0929c4625eD5bAd873c95208D54E1c003b2d
SPY=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
META=0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35
AMZN=0x12f190a9F9d7D37a250758b26824B97CE941bF54
GOOGL=0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3

cd "$(dirname "$0")/../contracts"
[ "$(cast chain-id --rpc-url "$RPC")" = "31337" ] || { echo "start anvil with --chain-id 31337 first"; exit 1; }

START=$(cast block-number --rpc-url "$RPC")
UNISWAP_FACTORY=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA \
ASSETS=$USDG,$NVDA,$TSLA,$SPY,$META,$AMZN,$GOOGL \
MAX_DEPOSITS=1000000000,10000000000000000000,10000000000000000000,10000000000000000000,10000000000000000000,10000000000000000000,10000000000000000000 \
MAX_POOL=100000000000,1000000000000000000000,1000000000000000000000,1000000000000000000000,1000000000000000000000,1000000000000000000000,1000000000000000000000 \
forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key $DEPLOYER_KEY --broadcast --slow -q

# Give the test account 2,000 USDG by writing its balance slot.
SLOT=$(TOKEN=$USDG HOLDER=$USER forge script script/BalanceSlot.s.sol --rpc-url "$RPC" 2>/dev/null | grep -oE '0x[0-9a-f]{64}' | tail -1)
cast rpc anvil_setStorageAt $USDG "$SLOT" $(cast to-uint256 2000000000) --rpc-url "$RPC" >/dev/null
echo "test account $USER has $(cast call $USDG 'balanceOf(address)(uint256)' $USER --rpc-url "$RPC") USDG units"
python3 - "$START" <<'PY'
import json, sys
p = 'deployments/31337.json'
d = json.load(open(p)); d['startBlock'] = int(sys.argv[1]); d['rpc'] = 'http://127.0.0.1:8545'
json.dump(d, open(p, 'w'), indent=2)
print(json.dumps(d, indent=2))
PY
