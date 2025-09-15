// Import necessary constants from the crate
// Import error handling
use crate::err::AmmError;
// Import math utilities
// Import bonding curve pool model
use crate::models::bound::BoundPool;
// Import Anchor lang prelude
use anchor_lang::prelude::*;
// Import SPL token program types
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

impl<'info> SwapCoinY<'info> {
    // Helper function to create CPI context for transferring WSOL from user to pool quote vault
    fn send_user_tokens(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.user_sol.to_account_info(),
            to: self.quote_vault.to_account_info(),
            authority: self.owner.to_account_info(),
        };

        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    // Helper function to create CPI context for transferring meme tokens to user wallet
    fn send_meme_to_user(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.meme_vault.to_account_info(),
            to: self.user_meme.to_account_info(),
            authority: self.pool_signer_pda.to_account_info(),
        };

        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    // NEW: Helper function to create CPI context for transferring fees to fee vault
    fn send_fees_to_vault(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.quote_vault.to_account_info(),
            to: self.fee_quote_vault.to_account_info(),
            authority: self.pool_signer_pda.to_account_info(),
        };

        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

// Handler function for swapping SOL for meme tokens
//
// # Arguments
// * `ctx` - The context containing all required accounts
// * `coin_in_amount` - Amount of SOL to swap
// * `coin_x_min_value` - Minimum amount of meme tokens to receive
pub fn handle(ctx: Context<SwapCoinY>, coin_in_amount: u64, coin_x_min_value: u64) -> Result<()> {
    // Get accounts from context
    let accs = ctx.accounts;

    // Check that input amount is not zero
    if coin_in_amount == 0 {
        return Err(error!(AmmError::NoZeroTokens));
    }

    // Check that pool is not locked
    if accs.pool.locked {
        return Err(error!(AmmError::PoolIsLocked));
    }

    // Calculate swap amounts
    let swap_amount = accs
        .pool
        .swap_amounts(coin_in_amount, coin_x_min_value, true);

    // Transfer SOL from user to pool
    token::transfer(
        accs.send_user_tokens(),
        swap_amount.amount_in + swap_amount.admin_fee_in,
    )?;

    // Create pool signer PDA seeds for meme token transfer
    let pool_signer_seeds = &[
        BoundPool::SIGNER_PDA_PREFIX,
        &accs.pool.key().to_bytes()[..],
        &[ctx.bumps.pool_signer_pda],
    ];

    // Transfer meme tokens directly to user's wallet
    token::transfer(
        accs.send_meme_to_user()
            .with_signer(&[&pool_signer_seeds[..]]),
        swap_amount.amount_out,
    )?;

    // NEW: Transfer quote fees to fee vault
    if swap_amount.admin_fee_in > 0 {
        token::transfer(
            accs.send_fees_to_vault()
                .with_signer(&[&pool_signer_seeds[..]]),
            swap_amount.admin_fee_in,
        )?;
    }

    // Get mutable reference to pool
    let pool = &mut accs.pool;

    // Update pool admin fees
    pool.admin_fees_quote += swap_amount.admin_fee_in;
    pool.admin_fees_meme += swap_amount.admin_fee_out;

    // Update pool reserves
    pool.quote_reserve.tokens += swap_amount.amount_in;
    pool.meme_reserve.tokens -= swap_amount.amount_out + swap_amount.admin_fee_out;

    // Lock pool if meme tokens depleted
    if pool.quote_reserve.tokens == pool.config.gamma_s {
        pool.locked = true;
    };

    // Log swap amounts
    msg!(
        "swapped_in: {}\n swapped_out: {}",
        swap_amount.amount_in,
        swap_amount.amount_out
    );

    Ok(())
}

// Account validation struct for swapping SOL for meme tokens
#[derive(Accounts)]
#[instruction(coin_in_amount: u64, coin_x_min_value: u64)]
pub struct SwapCoinY<'info> {
    // The pool account that will be modified during the swap
    #[account(mut)]
    pool: Account<'info, BoundPool>,

    // The pool's meme token vault that holds meme tokens
    #[account(
        mut,
        constraint = pool.meme_reserve.vault == meme_vault.key()
    )]
    meme_vault: Account<'info, TokenAccount>,

    // The pool's quote token vault that holds SOL
    #[account(
        mut,
        constraint = pool.quote_reserve.vault == quote_vault.key()
    )]
    quote_vault: Account<'info, TokenAccount>,

    // The user's SOL token account that will send tokens
    #[account(mut)]
    user_sol: Account<'info, TokenAccount>,

    // The user's meme token account that will receive tokens directly
    #[account(
        mut,
        constraint = user_meme.mint == pool.meme_reserve.mint @ AmmError::InvalidTokenMints,
        constraint = user_meme.owner == owner.key()
    )]
    user_meme: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_quote_vault.key() == pool.fee_vault_quote
            @ AmmError::InvalidFeeQuoteVault,
    )]
    /// The account representing the fee quote vault.
    pub fee_quote_vault: Account<'info, TokenAccount>,

    // The owner/signer of the transaction
    #[account(mut)]
    owner: Signer<'info>,

    /// CHECK: PDA signer for the pool - seeds validation ensures this is the correct pool authority
    #[account(seeds = [BoundPool::SIGNER_PDA_PREFIX, pool.key().as_ref()], bump)]
    pool_signer_pda: AccountInfo<'info>,

    // The SPL token program
    token_program: Program<'info, Token>,
}
