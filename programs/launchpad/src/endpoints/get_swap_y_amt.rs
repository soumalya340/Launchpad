use crate::models::bound::BoundPool;
use anchor_lang::prelude::*;

// Define a return struct for swap amounts
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapYResult {
    pub amount_in: u64,
    pub amount_out: u64,
    pub admin_fee_in: u64,
    pub admin_fee_out: u64,
}

pub fn handle(
    ctx: Context<GetSwapYAmt>,
    coin_in_amount: u64,
    coin_x_min_value: u64,
) -> Result<SwapYResult> {
    let swap_amount = ctx
        .accounts
        .pool
        .swap_amounts(coin_in_amount, coin_x_min_value, true);

    msg!(
        "swapped_in: {}\n swapped_out: {}",
        swap_amount.amount_in,
        swap_amount.amount_out
    );

    // Return the swap amounts
    Ok(SwapYResult {
        amount_in: swap_amount.amount_in,
        amount_out: swap_amount.amount_out,
        admin_fee_in: swap_amount.admin_fee_in,
        admin_fee_out: swap_amount.admin_fee_out,
    })
}

#[derive(Accounts)]
pub struct GetSwapYAmt<'info> {
    pub pool: Account<'info, BoundPool>,
}
