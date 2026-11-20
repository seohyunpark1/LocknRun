//! Pure settlement math, kept free of Solana types so it can be unit-tested on the host.
//! Amounts are integer micro-USDC. These rules mirror `lib/settle.ts` in the app.

pub const BPS: u128 = 10_000;
pub const SAFE_BPS: u16 = 8_500; // by-fraction mode: 85%+ gets the full stake back
pub const FULL_BPS: u16 = 10_000;

pub const MODE_POOL: u8 = 0; // all or nothing
pub const MODE_FRACTION: u8 = 1; // Challengers-style tiers

/// Stake returned to a non-finisher in by-fraction mode.
pub fn fraction_back(stake: u64, rate_bps: u16) -> u64 {
    if rate_bps >= FULL_BPS || rate_bps >= SAFE_BPS {
        stake
    } else {
        ((stake as u128) * (rate_bps as u128) / BPS) as u64
    }
}

/// Result of finalizing a room that has at least one finisher.
#[derive(Debug, PartialEq, Eq)]
pub struct Split {
    pub share: u64,     // base amount per finisher (pool: the whole payout; fraction: the prize on top of the stake)
    pub remainder: u32, // pool mode: finishers with rank < remainder get one extra micro-unit
    pub fee: u64,       // pool mode platform fee, claimable by the fee recipient
}

/// All-or-nothing: finishers share N*D + B - fee, where fee = fee_bps of forfeited stakes (rounded down).
pub fn pool_split(participants: u32, finishers: u32, stake: u64, sponsor_total: u64, fee_bps: u16) -> Option<Split> {
    if finishers == 0 || finishers > participants {
        return None;
    }
    let n = participants as u128;
    let w = finishers as u128;
    let d = stake as u128;
    let forfeited = (n - w) * d;
    let fee = forfeited * (fee_bps as u128) / BPS;
    let distributable = n * d + sponsor_total as u128 - fee;
    Some(Split { share: (distributable / w) as u64, remainder: (distributable % w) as u32, fee: fee as u64 })
}

/// By fraction: finishers get their stake back plus an equal share of (what others did not get back + sponsor bonuses).
pub fn fraction_split(finishers: u32, prize_extra: u64, sponsor_total: u64) -> Option<Split> {
    if finishers == 0 {
        return None;
    }
    let prize = prize_extra as u128 + sponsor_total as u128;
    Some(Split { share: (prize / finishers as u128) as u64, remainder: 0, fee: 0 })
}

/// What one participant is owed after finalization.
pub fn payout(mode: u8, stake: u64, split: &Split, finisher: bool, finisher_rank: u32, fraction_back_amount: u64) -> u64 {
    if mode == MODE_FRACTION {
        if finisher { stake + split.share } else { fraction_back_amount }
    } else if finisher {
        split.share + if finisher_rank < split.remainder { 1 } else { 0 }
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const D: u64 = 10_000_000;

    #[test]
    fn pool_three_of_five_matches_the_structure_document() {
        let s = pool_split(5, 3, D, 0, 500).unwrap();
        assert_eq!(s.fee, 1_000_000);
        let total: u64 = (0..3).map(|rank| payout(MODE_POOL, D, &s, true, rank, 0)).sum();
        assert_eq!(total, 49_000_000);
        assert_eq!(payout(MODE_POOL, D, &s, true, 0, 0), 16_333_334);
        assert_eq!(payout(MODE_POOL, D, &s, true, 1, 0), 16_333_333);
        assert_eq!(payout(MODE_POOL, D, &s, true, 2, 0), 16_333_333);
        assert_eq!(payout(MODE_POOL, D, &s, false, 0, 0), 0);
    }

    #[test]
    fn pool_everyone_finishes_with_bonus() {
        let s = pool_split(5, 5, D, 10_000_000, 500).unwrap();
        assert_eq!(s.fee, 0);
        assert_eq!(payout(MODE_POOL, D, &s, true, 4, 0), 12_000_000);
    }

    #[test]
    fn nobody_finishing_has_no_split() {
        assert!(pool_split(5, 0, D, 0, 500).is_none());
        assert!(fraction_split(0, 0, 0).is_none());
    }

    #[test]
    fn pool_never_pays_more_than_it_holds() {
        for n in 1..12u32 {
            for w in 1..=n {
                let s = pool_split(n, w, 7_000_001, 25_000_000, 500).unwrap();
                let paid: u64 = (0..w).map(|r| payout(MODE_POOL, 7_000_001, &s, true, r, 0)).sum();
                assert_eq!(paid + s.fee, n as u64 * 7_000_001 + 25_000_000, "n={n} w={w}");
            }
        }
    }

    #[test]
    fn fraction_matches_the_readme_example() {
        // 3 runners x 20 USDC, 75 USDC bonus. Maria 100%, Daniel 50%, Kevin 0%.
        let d = 20_000_000;
        let daniel = fraction_back(d, 5_000);
        let kevin = fraction_back(d, 0);
        assert_eq!((daniel, kevin), (10_000_000, 0));
        let extra = (d - daniel) + (d - kevin);
        let s = fraction_split(1, extra, 75_000_000).unwrap();
        assert_eq!(payout(MODE_FRACTION, d, &s, true, 0, 0), 125_000_000);
        assert_eq!(payout(MODE_FRACTION, d, &s, false, 0, daniel), 10_000_000);
        assert_eq!(payout(MODE_FRACTION, d, &s, false, 0, kevin), 0);
    }

    #[test]
    fn fraction_85_percent_keeps_the_whole_stake() {
        assert_eq!(fraction_back(D, 8_500), D);
        assert_eq!(fraction_back(D, 8_499), 8_499_000);
    }
}
