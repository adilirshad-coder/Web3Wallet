//! Program-wide constants: PDA seeds and default configuration values.

pub const WALLET_SEED: &[u8] = b"wallet";
pub const SOL_SEED: &[u8] = b"sol";
pub const CONFIG_SEED: &[u8] = b"config";

pub const BASIS_POINTS: u128 = 10_000;
pub const DEFAULT_FEE_BPS: u16 = 25;
pub const DEFAULT_MAX_FEE_BPS: u16 = 100;
pub const DEFAULT_MAX_SLIPPAGE_BPS: u16 = 500;
