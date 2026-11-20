//! Lock&Run escrow: one USDC vault per challenge room.
//!
//! * Participants and sponsors deposit into a vault owned by the room PDA. Nobody, including the platform, can withdraw
//!   from it except through the rules below.
//! * After the room ends, the room's `verifier` records each participant's result (in join order) and finalizes.
//!   The program computes every payout; the verifier chooses only who finished.
//! * Payouts and refunds are permissionless cranks that can only pay the recorded wallet's own token account.
//! * If no result is finalized before `timeout_at`, everyone can be refunded. Finalizing and refunding are mutually exclusive.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod math;
use math::*;

declare_id!("DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj");

pub const ROOM_SEED: &[u8] = b"room";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PARTICIPANT_SEED: &[u8] = b"p";
pub const SPONSOR_SEED: &[u8] = b"s";
/// Platform fee in all-or-nothing rooms: 5% of forfeited stakes.
pub const POOL_FEE_BPS: u16 = 500;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_FINALIZED: u8 = 1;
pub const STATUS_NOBODY_FINISHED: u8 = 2;

#[program]
pub mod lockrun_escrow {
    use super::*;

    /// Create a room and its vault. Rules (stake, mode, schedule, verifier, fee recipient) are fixed from here on.
    pub fn create_room(
        ctx: Context<CreateRoom>,
        room_id: [u8; 16],
        stake: u64,
        mode: u8,
        ends_at: i64,
        timeout_secs: i64,
        verifier: Pubkey,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(stake > 0, EscrowError::InvalidStake);
        require!(mode == MODE_POOL || mode == MODE_FRACTION, EscrowError::InvalidMode);
        require!(ends_at > now, EscrowError::InvalidSchedule);
        require!(timeout_secs > 0, EscrowError::InvalidSchedule);
        let room = &mut ctx.accounts.room;
        room.room_id = room_id;
        room.creator = ctx.accounts.creator.key();
        room.verifier = verifier;
        room.fee_recipient = fee_recipient;
        room.mint = ctx.accounts.mint.key();
        room.stake = stake;
        room.mode = mode;
        room.fee_bps = if mode == MODE_POOL { POOL_FEE_BPS } else { 0 };
        room.ends_at = ends_at;
        room.timeout_at = ends_at.checked_add(timeout_secs).ok_or(EscrowError::Overflow)?;
        room.status = STATUS_OPEN;
        room.bump = ctx.bumps.room;
        emit!(RoomCreated { room: room.key(), creator: room.creator, mint: room.mint, stake, mode, ends_at });
        Ok(())
    }

    /// Transfer exactly the stake into the vault and register the wallet once.
    pub fn join_room(ctx: Context<JoinRoom>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(room.status == STATUS_OPEN && Clock::get()?.unix_timestamp < room.ends_at, EscrowError::RoomClosed);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            room.stake,
        )?;
        let p = &mut ctx.accounts.participant;
        p.room = room.key();
        p.wallet = ctx.accounts.user.key();
        p.index = room.participants;
        p.bump = ctx.bumps.participant;
        room.participants = room.participants.checked_add(1).ok_or(EscrowError::Overflow)?;
        emit!(Joined { room: room.key(), wallet: p.wallet, index: p.index, amount: room.stake });
        Ok(())
    }

    /// A sponsor adds a bonus before the room ends. One bonus per wallet.
    pub fn fund_sponsor(ctx: Context<FundSponsor>, amount: u64) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(room.status == STATUS_OPEN && Clock::get()?.unix_timestamp < room.ends_at, EscrowError::RoomClosed);
        require!(amount > 0, EscrowError::InvalidStake);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
        )?;
        let s = &mut ctx.accounts.sponsor;
        s.room = room.key();
        s.funder = ctx.accounts.funder.key();
        s.amount = amount;
        s.bump = ctx.bumps.sponsor;
        room.sponsor_total = room.sponsor_total.checked_add(amount).ok_or(EscrowError::Overflow)?;
        emit!(SponsorFunded { room: room.key(), funder: s.funder, amount });
        Ok(())
    }

    /// Verifier records one participant's completed share of the goal, in join order, after the room ends.
    pub fn record_result(ctx: Context<RecordResult>, rate_bps: u16) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let now = Clock::get()?.unix_timestamp;
        require!(room.status == STATUS_OPEN, EscrowError::AlreadyFinalized);
        require!(now >= room.ends_at && now < room.timeout_at, EscrowError::WrongPhase);
        require!(rate_bps <= FULL_BPS, EscrowError::InvalidRate);
        let p = &mut ctx.accounts.participant;
        require!(p.index == room.recorded, EscrowError::OutOfOrder);
        p.rate_bps = rate_bps;
        if rate_bps == FULL_BPS {
            p.finisher = true;
            p.finisher_rank = room.finishers;
            room.finishers = room.finishers.checked_add(1).ok_or(EscrowError::Overflow)?;
        } else if room.mode == MODE_FRACTION {
            p.back = fraction_back(room.stake, rate_bps);
            room.prize_extra = room.prize_extra.checked_add(room.stake - p.back).ok_or(EscrowError::Overflow)?;
        }
        room.recorded += 1;
        Ok(())
    }

    /// Verifier finalizes once every participant is recorded. The program computes all allocations.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        let now = Clock::get()?.unix_timestamp;
        require!(room.status == STATUS_OPEN, EscrowError::AlreadyFinalized);
        require!(now >= room.ends_at && now < room.timeout_at, EscrowError::WrongPhase);
        require!(room.participants > 0 && room.recorded == room.participants, EscrowError::NotAllRecorded);
        if room.finishers == 0 {
            room.status = STATUS_NOBODY_FINISHED; // every stake and sponsor bonus is returned
        } else {
            let split = if room.mode == MODE_FRACTION {
                fraction_split(room.finishers, room.prize_extra, room.sponsor_total)
            } else {
                pool_split(room.participants, room.finishers, room.stake, room.sponsor_total, room.fee_bps)
            }
            .ok_or(EscrowError::Overflow)?;
            room.share = split.share;
            room.remainder = split.remainder;
            room.fee_amount = split.fee;
            room.status = STATUS_FINALIZED;
        }
        emit!(Finalized { room: room.key(), status: room.status, finishers: room.finishers, share: room.share, fee: room.fee_amount });
        Ok(())
    }

    /// Pay a participant what the room owes them (reward, stake refund, or the timeout refund). Anyone may call it;
    /// the destination must be the recorded wallet's own token account.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let room = &ctx.accounts.room;
        let p = &mut ctx.accounts.participant;
        require!(!p.claimed, EscrowError::AlreadyClaimed);
        let now = Clock::get()?.unix_timestamp;
        let amount = if room.status == STATUS_NOBODY_FINISHED || (room.status == STATUS_OPEN && now >= room.timeout_at) {
            room.stake
        } else if room.status == STATUS_FINALIZED {
            let split = Split { share: room.share, remainder: room.remainder, fee: room.fee_amount };
            payout(room.mode, room.stake, &split, p.finisher, p.finisher_rank, p.back)
        } else {
            return err!(EscrowError::WrongPhase);
        };
        p.claimed = true;
        if amount > 0 {
            vault_transfer(room, &ctx.accounts.vault, &ctx.accounts.destination, &ctx.accounts.token_program, amount)?;
        }
        emit!(Claimed { room: room.key(), wallet: p.wallet, amount });
        Ok(())
    }

    /// Return a sponsor bonus when nobody finished, or when no result arrived before the timeout.
    pub fn return_sponsor(ctx: Context<ReturnSponsor>) -> Result<()> {
        let room = &ctx.accounts.room;
        let s = &mut ctx.accounts.sponsor;
        require!(!s.returned, EscrowError::AlreadyClaimed);
        let now = Clock::get()?.unix_timestamp;
        require!(room.status == STATUS_NOBODY_FINISHED || (room.status == STATUS_OPEN && now >= room.timeout_at), EscrowError::WrongPhase);
        s.returned = true;
        vault_transfer(room, &ctx.accounts.vault, &ctx.accounts.destination, &ctx.accounts.token_program, s.amount)?;
        emit!(SponsorReturned { room: room.key(), funder: s.funder, amount: s.amount });
        Ok(())
    }

    /// Send the platform fee (all-or-nothing rooms) to the fee recipient fixed at room creation.
    pub fn claim_fee(ctx: Context<ClaimFee>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(room.status == STATUS_FINALIZED, EscrowError::WrongPhase);
        require!(!room.fee_claimed, EscrowError::AlreadyClaimed);
        room.fee_claimed = true;
        if room.fee_amount > 0 {
            let amount = room.fee_amount;
            vault_transfer(&*room, &ctx.accounts.vault, &ctx.accounts.destination, &ctx.accounts.token_program, amount)?;
        }
        emit!(FeeClaimed { room: room.key(), amount: room.fee_amount });
        Ok(())
    }
}

fn vault_transfer<'info>(
    room: &Account<'info, Room>,
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[ROOM_SEED, room.room_id.as_ref(), &[room.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer { from: vault.to_account_info(), to: destination.to_account_info(), authority: room.to_account_info() },
            &[seeds],
        ),
        amount,
    )
}

// ------------------------------------------------------------------ accounts

#[account]
#[derive(InitSpace)]
pub struct Room {
    pub room_id: [u8; 16],
    pub creator: Pubkey,
    pub verifier: Pubkey,
    pub fee_recipient: Pubkey,
    pub mint: Pubkey,
    pub stake: u64,
    pub mode: u8,
    pub fee_bps: u16,
    pub ends_at: i64,
    pub timeout_at: i64,
    pub participants: u32,
    pub recorded: u32,
    pub finishers: u32,
    pub sponsor_total: u64,
    pub prize_extra: u64,
    pub status: u8,
    pub share: u64,
    pub remainder: u32,
    pub fee_amount: u64,
    pub fee_claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub room: Pubkey,
    pub wallet: Pubkey,
    pub index: u32,
    pub rate_bps: u16,
    pub finisher: bool,
    pub finisher_rank: u32,
    pub back: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Sponsor {
    pub room: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
    pub returned: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 16])]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = creator, space = 8 + Room::INIT_SPACE, seeds = [ROOM_SEED, room_id.as_ref()], bump)]
    pub room: Account<'info, Room>,
    #[account(init, payer = creator, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinRoom<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = room.mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = room.mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(init, payer = user, space = 8 + Participant::INIT_SPACE, seeds = [PARTICIPANT_SEED, room.key().as_ref(), user.key().as_ref()], bump)]
    pub participant: Account<'info, Participant>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundSponsor<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = room.mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = room.mint, token::authority = funder)]
    pub funder_token: Account<'info, TokenAccount>,
    #[account(init, payer = funder, space = 8 + Sponsor::INIT_SPACE, seeds = [SPONSOR_SEED, room.key().as_ref(), funder.key().as_ref()], bump)]
    pub sponsor: Account<'info, Sponsor>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordResult<'info> {
    #[account(constraint = verifier.key() == room.verifier @ EscrowError::NotVerifier)]
    pub verifier: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, has_one = room, seeds = [PARTICIPANT_SEED, room.key().as_ref(), participant.wallet.as_ref()], bump = participant.bump)]
    pub participant: Account<'info, Participant>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(constraint = verifier.key() == room.verifier @ EscrowError::NotVerifier)]
    pub verifier: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = room.mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, has_one = room, seeds = [PARTICIPANT_SEED, room.key().as_ref(), participant.wallet.as_ref()], bump = participant.bump)]
    pub participant: Account<'info, Participant>,
    /// Always the participant's own token account, whoever submits the transaction.
    #[account(mut, token::mint = room.mint, token::authority = participant.wallet)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReturnSponsor<'info> {
    #[account(seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = room.mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, has_one = room, seeds = [SPONSOR_SEED, room.key().as_ref(), sponsor.funder.as_ref()], bump = sponsor.bump)]
    pub sponsor: Account<'info, Sponsor>,
    #[account(mut, token::mint = room.mint, token::authority = sponsor.funder)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimFee<'info> {
    #[account(mut, seeds = [ROOM_SEED, room.room_id.as_ref()], bump = room.bump)]
    pub room: Account<'info, Room>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump, token::mint = room.mint, token::authority = room)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = room.mint, token::authority = room.fee_recipient)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ------------------------------------------------------------------ events (decoded by QuickNode Streams)

#[event]
pub struct RoomCreated { pub room: Pubkey, pub creator: Pubkey, pub mint: Pubkey, pub stake: u64, pub mode: u8, pub ends_at: i64 }
#[event]
pub struct Joined { pub room: Pubkey, pub wallet: Pubkey, pub index: u32, pub amount: u64 }
#[event]
pub struct SponsorFunded { pub room: Pubkey, pub funder: Pubkey, pub amount: u64 }
#[event]
pub struct Finalized { pub room: Pubkey, pub status: u8, pub finishers: u32, pub share: u64, pub fee: u64 }
#[event]
pub struct Claimed { pub room: Pubkey, pub wallet: Pubkey, pub amount: u64 }
#[event]
pub struct SponsorReturned { pub room: Pubkey, pub funder: Pubkey, pub amount: u64 }
#[event]
pub struct FeeClaimed { pub room: Pubkey, pub amount: u64 }

#[error_code]
pub enum EscrowError {
    #[msg("Stake or amount must be greater than zero")]
    InvalidStake,
    #[msg("Unknown reward mode")]
    InvalidMode,
    #[msg("Invalid schedule")]
    InvalidSchedule,
    #[msg("The room is closed for deposits")]
    RoomClosed,
    #[msg("Only the room verifier can do this")]
    NotVerifier,
    #[msg("Not allowed in the room's current phase")]
    WrongPhase,
    #[msg("Results were already finalized")]
    AlreadyFinalized,
    #[msg("Rate must be 0 to 10000 basis points")]
    InvalidRate,
    #[msg("Participants must be recorded in join order")]
    OutOfOrder,
    #[msg("Every participant must be recorded first")]
    NotAllRecorded,
    #[msg("Already paid")]
    AlreadyClaimed,
    #[msg("Arithmetic overflow")]
    Overflow,
}
