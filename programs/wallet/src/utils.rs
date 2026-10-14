//! Pure helpers (no account access) so they can be unit-tested with `cargo test`.

use anchor_lang::prelude::*;

use crate::constants::BASIS_POINTS;
use crate::error::WalletError;

pub fn calculate_fee(amount: u64, bps: u16) -> Result<u64> {
    require!(bps <= 10_000, WalletError::InvalidLimits);
    let product = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(WalletError::MathOverflow)?;
    let fee = product
        .checked_add(BASIS_POINTS - 1)
        .ok_or(WalletError::MathOverflow)?
        .checked_div(BASIS_POINTS)
        .ok_or(WalletError::MathOverflow)?;
    let fee = u64::try_from(fee).map_err(|_| WalletError::MathOverflow)?;
    require!(bps == 0 || fee > 0, WalletError::FeeRoundsToZero);
    Ok(fee)
}

#[cfg(test)]
mod tests {
    use super::calculate_fee;

    #[test]
    fn fee_calculation_matches_shared_vectors() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!("../../../tests/vectors/fee.json"))
            .expect("fee vectors are valid JSON");

        for vector in vectors.as_array().expect("fee vector array") {
            let name = vector["name"].as_str().expect("vector name");
            let amount: u64 = vector["amount"].as_str().expect("amount string").parse().expect("u64 amount");
            let bps = vector["bps"].as_u64().expect("basis points") as u16;

            match vector["error"].as_str() {
                Some("invalid_limits") => assert!(calculate_fee(amount, bps).is_err(), "{name}"),
                Some("overflow") => {
                    let fee = calculate_fee(amount, bps).expect("fee itself fits u64");
                    assert!(amount.checked_add(fee).is_none(), "{name}");
                }
                None => {
                    let fee = calculate_fee(amount, bps).expect(name);
                    assert_eq!(fee.to_string(), vector["fee"].as_str().expect("expected fee"), "{name}");
                    let total = amount.checked_add(fee).expect("total debit fits");
                    assert_eq!(total.to_string(), vector["totalDebit"].as_str().expect("expected total"), "{name}");
                }
                Some(other) => panic!("unknown fee vector error: {other}"),
            }
        }
    }
}
