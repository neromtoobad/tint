// The parts of the TintPool ABI the wallet uses.
const PROOF = {
  name: 'p',
  type: 'tuple',
  components: [
    { name: 'proof', type: 'bytes' },
    { name: 'root', type: 'uint256' },
    { name: 'publicAsset', type: 'uint256' },
    { name: 'publicIn', type: 'uint256' },
    { name: 'publicOut', type: 'uint256' },
    { name: 'nullifiers', type: 'uint256[2]' },
    { name: 'outCommitments', type: 'uint256[2]' },
  ],
};
const EXT = {
  name: 'ext',
  type: 'tuple',
  components: [
    { name: 'recipient', type: 'address' },
    { name: 'relayer', type: 'address' },
    { name: 'fee', type: 'uint256' },
    { name: 'encryptedOutput0', type: 'bytes' },
    { name: 'encryptedOutput1', type: 'bytes' },
  ],
};
const SWAP_PROOF = {
  name: 'p',
  type: 'tuple',
  components: [
    { name: 'proof', type: 'bytes' },
    { name: 'root', type: 'uint256' },
    { name: 'nullifiers', type: 'uint256[2]' },
    { name: 'assetIn', type: 'uint256' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'assetOut', type: 'uint256' },
    { name: 'minOut', type: 'uint256' },
    { name: 'changeCommitment', type: 'uint256' },
    { name: 'outInner', type: 'uint256' },
  ],
};
const SWAP_EXT = {
  name: 'ext',
  type: 'tuple',
  components: [
    { name: 'relayer', type: 'address' },
    { name: 'fee', type: 'uint256' },
    { name: 'poolFee', type: 'uint24' },
    { name: 'deadline', type: 'uint256' },
    { name: 'encryptedChange', type: 'bytes' },
    { name: 'encryptedOut', type: 'bytes' },
  ],
};

export const tintPoolAbi = [
  { type: 'function', name: 'transact', stateMutability: 'nonpayable', inputs: [PROOF, EXT], outputs: [] },
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [SWAP_PROOF, SWAP_EXT],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tree',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'nullifierSpent',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'NewCommitment',
    inputs: [
      { name: 'commitment', type: 'uint256', indexed: true },
      { name: 'index', type: 'uint32', indexed: false },
      { name: 'encryptedOutput', type: 'bytes', indexed: false },
    ],
  },
  { type: 'event', name: 'NewNullifier', inputs: [{ name: 'nullifier', type: 'uint256', indexed: true }] },
  {
    type: 'event',
    name: 'Transacted',
    inputs: [
      { name: 'publicAsset', type: 'uint256', indexed: false },
      { name: 'publicIn', type: 'uint256', indexed: false },
      { name: 'publicOut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'assetIn', type: 'address', indexed: true },
      { name: 'assetOut', type: 'address', indexed: true },
      { name: 'amountSold', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
  { type: 'error', name: 'UnknownRoot', inputs: [] },
  { type: 'error', name: 'NullifierSpent', inputs: [{ name: 'nullifier', type: 'uint256' }] },
  { type: 'error', name: 'InvalidProof', inputs: [] },
  { type: 'error', name: 'DepositsArePaused', inputs: [] },
  { type: 'error', name: 'AssetNotListed', inputs: [{ name: 'asset', type: 'address' }] },
  { type: 'error', name: 'DepositTooLarge', inputs: [] },
  { type: 'error', name: 'PoolCapReached', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'NoUniswapPool', inputs: [] },
  {
    type: 'error',
    name: 'TooLittleReceived',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'PartialFill', inputs: [] },
];

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
];
