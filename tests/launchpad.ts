import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Launchpad } from "../target/types/launchpad";
import { Account, Keypair, PublicKey } from "@solana/web3.js";
import {
  setAuthority,
  AuthorityType,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from "@solana/spl-token";
import { assert } from "chai";
import { createMemeMint } from "./utils";
import { wrapSol, LAMPORTS_PER_SOL } from "./wsol";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplTokenMetadata,
  findMetadataPda,
  fetchAllMetadata,
  fetchMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BP_FEE_KEY_PUBKEY, QUOTE_MINT } from "./config";
import {
  getTargetConfigPda,
  getPoolPda,
  getPoolSignerPda,
} from "./fetch_pda_account";
import {
  ComputeBudgetProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

describe("Launchpad", () => {
  let memeMint: PublicKey;
  let buyer: Keypair;
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const user = provider.wallet;
  const program = anchor.workspace.Launchpad as Program<Launchpad>;

  // Reusable function to create and fund a keypair
  async function createFundedKeypair(amountInSol = 2) {
    // Generate a random keypair
    const keypair = Keypair.generate();

    const airdropAmount = amountInSol * LAMPORTS_PER_SOL;
    const airdropTx = await provider.connection.requestAirdrop(
      keypair.publicKey,
      airdropAmount
    );
    await provider.connection.confirmTransaction(airdropTx);
    // Return the funded keypair
    return keypair;
  }

  before(async () => {
    memeMint = await createMemeMint();
    buyer = await createFundedKeypair(100);
  });

  it("should create a target config and new pool", async () => {
    // Step 1: Set up the sender
    const sender = user;
    const payer = (sender as any).payer;
    const connection = provider.connection;
    try {
      const targetAmount = new BN(55 * LAMPORTS_PER_SOL); // 2 SOL in lamports as BN

      // console.log("Creating target config...");
      const tx = await program.methods
        .initTargetConfig(targetAmount)
        .accounts({
          tokenMint: QUOTE_MINT, // ✅ Quote token (WSOL)
          pairTokenMint: memeMint, // ✅ Meme token
        })
        .rpc();
      // console.log("Target config created", tx);
    } catch (error) {
      console.error("Error creating target config:", error);
      throw error;
    }
    const targetConfigPda = getTargetConfigPda(memeMint)[0];

    // Step 6: Derive PDAs (these are automatic!)
    const poolPda = getPoolPda(memeMint)[0];

    const poolSigner = getPoolSignerPda(poolPda)[0];

    // Create quote vault token account(owned by pool signer PDA)
    const quoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      poolSigner,
      true
    );

    // Create Associated Token Account for meme tokens (owned by pool signer)
    const memeVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      memeMint,
      poolSigner,
      true
    );

    // console.log("Setting authority of meme mint to pool signer...");
    try {
      // Change the mint authority from payer to pool signer
      const tx = await setAuthority(
        connection,
        payer,
        memeMint, // the mint account, not the vault
        payer, // current mint authority
        AuthorityType.MintTokens,
        poolSigner // new mint authority
      );
    } catch (error) {
      console.error("Error setting authority of meme mint:", error);
      throw error;
    }

    // // CREATE FEE FEE QUOTE VAULT

    // Create Associated Token Account for fee vault (owned by fee authority)
    const feeQuoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      BP_FEE_KEY_PUBKEY
    );

    // // CALL INITIALIZE_POOL
    try {
      // console.log("Creating new pool...");
      const tx = await program.methods
        .newPool()
        .accounts({
          memeMint: memeMint,
          quoteVault: quoteVault.address,
          quoteMint: QUOTE_MINT,
          feeQuoteVault: feeQuoteVault.address,
          memeVault: memeVault.address,
          targetConfig: targetConfigPda,
        })
        .rpc();
      // console.log("Creating new pool", tx);
    } catch (error) {
      console.error("Error initializing pool:", error);
      throw error;
    }

    const poolAccount = await program.account.boundPool.fetch(poolPda);
    assert.equal(poolAccount.memeReserve.mint.toBase58(), memeMint.toBase58());
    assert.equal(
      poolAccount.quoteReserve.mint.toBase58(),
      QUOTE_MINT.toBase58()
    );
    assert.equal(
      poolAccount.feeVaultQuote.toBase58(),
      feeQuoteVault.address.toBase58()
    );
    assert.equal(
      poolAccount.memeReserve.vault.toBase58(),
      memeVault.address.toBase58()
    );
  });
  it.skip("should create metadata", async () => {
    // Import the correct metadata program ID
    let newMintMeme = new PublicKey(
      "8iVMJD6YiExi8zfp1eHY7aqgUBcsk1wEWCgPyhQP6eCH"
    );
    const METADATA_PROGRAM_ID = new PublicKey(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );

    const [poolPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bound_pool"),
        newMintMeme.toBuffer(),
        QUOTE_MINT.toBuffer(),
      ],
      program.programId
    );
    const [poolSigner] = PublicKey.findProgramAddressSync(
      [Buffer.from("signer"), poolPda.toBuffer()],
      program.programId
    );
    const [memeMplMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        newMintMeme.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    try {
      const tx = await program.methods
        .createMetadata(
          "meme4011",
          "MEME4011",
          "https://static.vecteezy.com/system/resources/thumbnails/033/662/051/small/cartoon-lofi-young-manga-style-girl-while-listening-to-music-in-the-rain-ai-generative-photo.jpg"
        )
        .accounts({
          memeMint: newMintMeme,
          pool: poolPda,
          memeMplMetadata: memeMplMetadata,
        })
        .accountsPartial({
          poolSigner: poolSigner,
          metadataProgram: METADATA_PROGRAM_ID,
        })
        .rpc();

      // console.log("Metadata created", tx);
      // const umi = createUmi("http://127.0.0.1:8899").use(mplTokenMetadata());
      // const assetPda = findMetadataPda(umi, {
      //   mint: publicKey(memeMint.toBase58()),
      // });
      // const asset = await fetchMetadata(umi, assetPda);

      // console.log("Asset:", asset);
    } catch (error) {
      console.error("Error creating metadata:", error);
      throw error;
    }
  });
  it("Should Swap Sol for Meme", async () => {
    const connection = provider.connection;
    const sender = user;
    const payer = (sender as any).payer;

    const targetConfigPda = getTargetConfigPda(memeMint)[0];

    // Step 6: Derive PDAs (these are automatic!)
    const poolPda = getPoolPda(memeMint)[0];

    const poolSigner = getPoolSignerPda(poolPda)[0];

    const quoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      QUOTE_MINT,
      poolSigner,
      true
    );

    // Step 6: Get existing meme vault (meme token vault owned by pool signer)
    const memeVault = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      memeMint,
      poolSigner,
      true
    );

    // Step 7: Verify pool account exists and get its state
    try {
      const poolAccount = await program.account.boundPool.fetch(poolPda);
      // Verify the vaults match what we expect
      assert.equal(
        poolAccount.memeReserve.vault.toBase58(),
        memeVault.address.toBase58(),
        "Meme vault mismatch"
      );
      assert.equal(
        poolAccount.quoteReserve.vault.toBase58(),
        quoteVault.address.toBase58(),
        "Quote vault mismatch"
      );
      assert.equal(
        poolAccount.locked,
        false,
        "Pool should not be locked initially"
      );
    } catch (error) {
      // console.error("Pool account not found or invalid:", error);
      throw error;
    }

    try {
      await program.account.targetConfig.fetch(targetConfigPda);
    } catch (error) {
      // console.error("Target config not found:", error);
      throw error;
    }

    // Create Associated Token Account for fee vault (owned by fee authority)
    const feeQuoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      BP_FEE_KEY_PUBKEY
    );

    // SWAP CONFIGURATION
    const userSolTokenAccount = await wrapSol(connection, buyer, 1);

    const userWsolBalance = await getAccount(connection, userSolTokenAccount);

    const userMemeTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      memeMint,
      buyer.publicKey
    );

    const userQuoteTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      QUOTE_MINT,
      buyer.publicKey
    );

    // Amount to Swap
    let coinInAmount = new BN(LAMPORTS_PER_SOL);
    let coinXMinValue = new BN(0);

    await program.methods
      .getSwapYAmt(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
      })
      .rpc();

    await program.methods
      .swapY(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
        quoteVault: quoteVault.address,
        memeVault: memeVault.address,
        feeQuoteVault: feeQuoteVault.address,
        userMeme: userMemeTokenAccount.address,
        userSol: userQuoteTokenAccount.address,
      })
      .accountsPartial({
        owner: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();
    // ===== POST-SWAP VERIFICATION =====
    // Fetch updated pool account
    const updatedPoolAccount = await program.account.boundPool.fetch(poolPda);

    // Get updated user token balances
    const updatedUserWsolBalance = await getAccount(
      connection,
      userQuoteTokenAccount.address
    );
    const updatedUserMemeBalance = await getAccount(
      connection,
      userMemeTokenAccount.address
    );

    // Get updated vault balances
    const updatedQuoteVaultBalance = await getAccount(
      connection,
      quoteVault.address
    );
    const updatedMemeVaultBalance = await getAccount(
      connection,
      memeVault.address
    );
  });

  it("Should Swap Meme for Sol", async () => {
    const connection = provider.connection;

    const sender = user;
    const payer = (sender as any).payer;

    const targetConfigPda = getTargetConfigPda(memeMint)[0];

    // Step 6: Derive PDAs (these are automatic!)
    const poolPda = getPoolPda(memeMint)[0];

    const poolSigner = getPoolSignerPda(poolPda)[0];

    const quoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      QUOTE_MINT,
      poolSigner,
      true // allowOwnerOffCurve for PDA
    );

    const memeVault = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      memeMint,
      poolSigner,
      true // allowOwnerOffCurve for PDA
    );

    try {
      await program.account.targetConfig.fetch(targetConfigPda);
    } catch (error) {
      console.error("Target config not found:", error);
      throw error;
    }

    // 1. Get the user's meme token account (user_meme)
    const userMemeTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      memeMint,
      buyer.publicKey
    );

    // 2. Get the user's quote token account (user_quote)
    const userQuoteTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      QUOTE_MINT,
      buyer.publicKey
    );

    // Amount to Swap
    const userMemeBalance = await getAccount(
      connection,
      userMemeTokenAccount.address
    );

    // Create Associated Token Account for fee vault (owned by fee authority)
    const feeQuoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      BP_FEE_KEY_PUBKEY
    );

    const coinInAmount = new BN(userMemeBalance.amount.toString());
    // console.log("Coin in amount:", coinInAmount.toString());

    let coinXMinValue = new BN(0);

    const swapTx = await program.methods
      .swapX(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
        feeQuoteVault: feeQuoteVault.address,
        quoteVault: quoteVault.address,
        memeVault: memeVault.address,
        userMeme: userMemeTokenAccount.address,
        userSol: userQuoteTokenAccount.address,
      })
      .accountsPartial({
        owner: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();

    // console.log("Swap transaction hash:", swapTx);

    // ===== POST-SWAP VERIFICATION =====
    // console.log("\n🔍 Starting post-swap verification...");

    // Get user WSOL balance before swap for comparison
    const userWsolBalanceBefore = await getAccount(
      connection,
      userQuoteTokenAccount.address
    );

    // Get updated user token balances after swap
    const updatedUserWsolBalance = await getAccount(
      connection,
      userQuoteTokenAccount.address
    );
    const updatedUserMemeBalance = await getAccount(
      connection,
      userMemeTokenAccount.address
    );

    // console.log(
    //   "User WSOL before swap:",
    //   userWsolBalanceBefore.amount.toString()
    // );
    // console.log(
    //   "User WSOL after swap:",
    //   updatedUserWsolBalance.amount.toString()
    // );
    // console.log("User MEME before swap:", userMemeBalance.amount.toString());
    // console.log(
    //   "User MEME after swap:",
    //   updatedUserMemeBalance.amount.toString()
    // );

    // Note: These balances might be the same if the swap transaction failed
    // Let's check if the swap actually succeeded by looking at the transaction
    // console.log(
    //   "Meme tokens swapped:",
    //   (userMemeBalance.amount - updatedUserMemeBalance.amount).toString()
    // );
    // console.log(
    //   "WSOL received:",
    //   (updatedUserWsolBalance.amount - userWsolBalanceBefore.amount).toString()
    // );
  });
  it.skip("Should Raydium Migrate", async () => {
    const sender = user;
    const payer = (sender as any).payer;
    const connection = provider.connection;

    const targetConfigPda = getTargetConfigPda(memeMint)[0];

    // Step 6: Derive PDAs (these are automatic!)
    const poolPda = getPoolPda(memeMint)[0];

    const poolSigner = getPoolSignerPda(poolPda)[0];

    // Step 5: Get existing quote vault (WSOL vault owned by pool signer)
    const quoteVault = await getAssociatedTokenAddress(
      QUOTE_MINT,
      poolSigner,
      true
    );
    // console.log("Quote vault in Migration:", quoteVault.toBase58());
    // Step 6: Get existing meme vault (meme token vault owned by pool signer)
    const memeVault = await getAssociatedTokenAddress(
      memeMint,
      poolSigner,
      true // allowOwnerOffCurve for PDA
    );
    // console.log("meme vault in Migration:", memeVault.toBase58());
    try {
      const accountInfo = await connection.getAccountInfo(memeVault);
    } catch (error) {
      console.log("Account not found");
    }

    //////////////////// BUYER AND USER CONFIGURATION /////////////////////////

    // Step 7: Verify target config exists
    await program.account.targetConfig.fetch(targetConfigPda);

    let amount = 56;
    // console.log("Testing Swaping Wsol for Meme with amount: ", amount);

    // console.log(
    //   "Buyer Sol balance before swap:",
    //   (await connection.getBalance(buyer.publicKey)) / LAMPORTS_PER_SOL
    // );

    // Step 8: Wrap SOL to get user's SOL token account

    await wrapSol(connection, buyer, amount);

    ///////////////////////////////////////////////////////////

    // 1. Get the user's meme token account (user_meme)
    const buyerMemeTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      memeMint,
      buyer.publicKey
    );
    // 2. Get the user's quote token account (user_quote)
    const buyerQuoteTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      QUOTE_MINT,
      buyer.publicKey
    );

    let buyerSolBalance1 = await getAccount(
      connection,
      buyerQuoteTokenAccount.address
    );

    // console.log(
    //   `buyer wsol balance before swap: ${(
    //     Number(buyerSolBalance1.amount) / LAMPORTS_PER_SOL
    //   ).toString()} for ${buyer.publicKey.toBase58()}`
    // );

    // const poolAccountBefore = await program.account.boundPool.fetch(poolPda);
    // console.log(
    //   "Pool meme reserve before swap: ",
    //   poolAccountBefore.memeReserve.tokens.toString()
    // );
    // console.log(
    //   "Pool quote reserve before swap: ",
    //   poolAccountBefore.quoteReserve.tokens.toString()
    // );

    // Amount to Swap - Make sure to trigger migration by reaching threshold
    let coinInAmount = new BN(amount * LAMPORTS_PER_SOL);
    let coinXMinValue = new BN(0);
    // Create Associated Token Account for fee vault (owned by fee authority)
    const feeQuoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      BP_FEE_KEY_PUBKEY
    );
    await program.methods
      .swapY(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
        feeQuoteVault: feeQuoteVault.address,
        quoteVault: quoteVault,
        memeVault: memeVault,
        userMeme: buyerMemeTokenAccount.address,
        userSol: buyerQuoteTokenAccount.address,
      })
      .accountsPartial({
        owner: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();

    // Check if the bonding curve is locked

    const poolAccountAfterSwap = await program.account.boundPool.fetch(poolPda);
    // console.log("Pool locked: ", poolAccountAfterSwap.locked);
    // console.log(
    //   "Pool meme reserve after swap: ",
    //   poolAccountAfterSwap.memeReserve.tokens.toString()
    // );
    // console.log(
    //   "Pool quote reserve after swap: ",
    //   poolAccountAfterSwap.quoteReserve.tokens.toString()
    // );

    // console.log("Setting up Raydium migrate test...");

    let buyerMemeBalance = await getAccount(
      connection,
      buyerMemeTokenAccount.address
    );
    let buyerSolBalance = await getAccount(
      connection,
      buyerQuoteTokenAccount.address
    );

    // console.log(
    //   `buyer meme balance: ${(
    //     Number(buyerMemeBalance.amount) / LAMPORTS_PER_SOL
    //   ).toString()} for ${buyer.publicKey.toBase58()}`
    // );
    // console.log(
    //   `buyer sol balance: ${(
    //     Number(buyerSolBalance.amount) / LAMPORTS_PER_SOL
    //   ).toString()} for ${buyer.publicKey.toBase58()}`
    // );

    //////////////////////////////////////////////////

    // console.log(
    //   `user token0 balance before: ${userSolBalanceBefore.amount.toString()} for ${payer.publicKey.toBase58()}`
    // );
    // console.log(
    //   `user token1 balance before: ${userMemeBalanceBefore.amount.toString()} for ${payer.publicKey.toBase58()}`
    // );

    // === RAYDIUM CPI SETUP ===

    const token0Mint = NATIVE_MINT;

    console.log("token0Mint", token0Mint.toBase58());
    const token1Mint = memeMint;

    console.log("token1Mint", token1Mint.toBase58());

    const poolToken0VaultAccount = await getAssociatedTokenAddress(
      token0Mint,
      poolSigner,
      true
    );

    const poolTokenVault1Account = await getAssociatedTokenAddress(
      token1Mint,
      poolSigner,
      true
    );

    const userToken1Account = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      token1Mint,
      payer.publicKey
    );
    // 2. Get the user's quote token account (user_quote)
    const userToken0Account = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      token0Mint,
      payer.publicKey
    );
    // AMM Config (use Raydium's standard config)
    // AMM Config for 2%
    const ammConfig = new PublicKey(
      "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2"
    );

    // Raydium CPMM Program ID
    // CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C
    const cpSwapProgram = new PublicKey(
      "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
    );

    // Derive Raydium Authority PDA
    const POOL_AUTH_SEED = Buffer.from(
      anchor.utils.bytes.utf8.encode("vault_and_lp_mint_auth_seed")
    );
    const [raydiumAuthority] = PublicKey.findProgramAddressSync(
      [POOL_AUTH_SEED],
      cpSwapProgram
    );
    // Derive Raydium Pool State PDA
    const POOL_SEED = Buffer.from(anchor.utils.bytes.utf8.encode("pool"));

    const [raydiumPoolState] = PublicKey.findProgramAddressSync(
      [
        POOL_SEED,
        ammConfig.toBuffer(),
        token0Mint.toBuffer(), // token_0
        token1Mint.toBuffer(), // token_1
      ],
      cpSwapProgram
    );
    // Derive Raydium LP Mint PDA
    const POOL_LPMINT_SEED = Buffer.from(
      anchor.utils.bytes.utf8.encode("pool_lp_mint")
    );
    const [raydiumLpMint] = PublicKey.findProgramAddressSync(
      [POOL_LPMINT_SEED, raydiumPoolState.toBuffer()],
      cpSwapProgram
    );
    // Derive Raydium Token Vaults
    const POOL_VAULT_SEED = Buffer.from(
      anchor.utils.bytes.utf8.encode("pool_vault")
    );
    const [token0Vault] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, raydiumPoolState.toBuffer(), token0Mint.toBuffer()],
      cpSwapProgram
    );

    const [token1Vault] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, raydiumPoolState.toBuffer(), token1Mint.toBuffer()],
      cpSwapProgram
    );

    // Derive Observation State PDA
    const ORACLE_SEED = Buffer.from(
      anchor.utils.bytes.utf8.encode("observation")
    );
    const [observationState] = PublicKey.findProgramAddressSync(
      [ORACLE_SEED, raydiumPoolState.toBuffer()],
      cpSwapProgram
    );

    // Creator LP Token Account (ATA) - derive address only, Raydium will create it
    const [creatorLpToken] = PublicKey.findProgramAddressSync(
      [
        payer.publicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        raydiumLpMint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    // Create Pool Fee Account - this needs to be an initialized token account
    const createPoolFeeReceiver = new PublicKey(
      "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"
    );

    const createPoolFee = new PublicKey(
      "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"
    );

    try {
      console.log("Start Migration");
      // Create compute budget instruction to request more CUs
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000, // Request 400k CUs (double the default)
      });
      // Build the migration instruction
      const migrationIx = await program.methods
        .migrateToRaydium()
        .accounts({
          pool: poolPda,
          token0Mint: token0Mint,
          token1Mint: token1Mint,
          poolToken0Vault: poolToken0VaultAccount,
          poolToken1Vault: poolTokenVault1Account,
          ammConfig: ammConfig,
          creatorToken0Account: userToken0Account.address,
          creatorToken1Account: userToken1Account.address,
          creatorLpToken: creatorLpToken,
        })
        .instruction();

      // Create transaction with both instructions
      const transaction = new Transaction().add(computeBudgetIx, migrationIx);

      // Send transaction
      const migrateTx = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer] // Add any other required signers
      );

      console.log("Migration transaction signature:", migrateTx);
      // // Get balances after migration
      // const token0BalanceAfter = await getAccount(
      //   connection,
      //   userToken0Account.address
      // );
      // const token1BalanceAfter = await getAccount(
      //   connection,
      //   userToken1Account.address
      // );
      console.log("✅ Migration successful!");

      // Verify migration
      const updatedPool = await program.account.boundPool.fetch(poolPda);
      console.log("Pool migration status:", updatedPool.poolMigration);
      console.log("Pool migration status:", updatedPool.migrationPoolKey);
    } catch (error) {
      console.error("❌ Migration failed:", error);
      console.log("Error details:", error.logs || error.message);
      throw error;
    }
  });
});

describe("Testing the bonding curve swap", () => {
  let memeMint: PublicKey;
  let alice: Keypair;
  let bob: Keypair;
  let user2: Keypair;
  let user3: Keypair;
  let poolPda: any;
  let memeVault: any;
  let quoteVault: any;
  let poolSigner: any;
  let targetConfigPda: any;
  let poolAccount: any;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const user = provider.wallet;
  const program = anchor.workspace.Launchpad as Program<Launchpad>;

  // Reusable function to create and fund a keypair
  async function createFundedKeypair(amountInSol = 2) {
    // Generate a random keypair
    const keypair = Keypair.generate();

    const airdropAmount = amountInSol * LAMPORTS_PER_SOL;
    const airdropTx = await provider.connection.requestAirdrop(
      keypair.publicKey,
      airdropAmount
    );
    await provider.connection.confirmTransaction(airdropTx);
    // Return the funded keypair
    return keypair;
  }

  // Reusable function to create and fund a keypair
  async function createTokenAccountMeme(
    connection: any,
    payer: any,
    owner: PublicKey,
    allowOwnerOffCurve: boolean = false
  ) {
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      memeMint,
      owner,
      allowOwnerOffCurve
    );
    return tokenAccount;
  }

  async function createTokenAccountQuote(
    connection: any,
    payer: any,
    owner: PublicKey,
    allowOwnerOffCurve: boolean = false
  ) {
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      owner,
      allowOwnerOffCurve
    );
    return tokenAccount;
  }

  // Helper function to format balance in millions
  function formatBalanceInMillions(balance: number): string {
    const millions = balance / 1_000_000;
    if (millions >= 1) {
      return `${
        millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)
      }M`;
    } else {
      return `${millions.toFixed(1)}M`;
    }
  }

  async function userAndPoolInfo(
    connection: any,
    userName: string = "User",
    wallet: Keypair,
    amount: number = 0
  ) {
    await wrapSol(connection, wallet, amount);
    // const userSolTokenAccount = await wrapSol(connection, wallet, amount);
    // const userWsolBalance = await getAccount(connection, userSolTokenAccount);
    // console.log("User Wsol balance: ", userWsolBalance.amount.toString());

    const userMemeTokenAccount = await createTokenAccountMeme(
      connection,
      wallet,
      wallet.publicKey
    );

    const userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      wallet,
      wallet.publicKey
    );

    // Amount to Swap
    // let coinInAmount = new BN(amount * LAMPORTS_PER_SOL);

    // console.log("User Meme balance: ", userMemeTokenAccount.amount.toString());
    const userMemeBalanceAmount =
      Number(userMemeTokenAccount.amount) / LAMPORTS_PER_SOL;

    const formattedMemeBalance = formatBalanceInMillions(userMemeBalanceAmount);

    console.log(`${userName} Wallet Meme balance: ${formattedMemeBalance}`);

    const userQuoteBalanceAmount =
      Number(userQuoteTokenAccount.amount) / LAMPORTS_PER_SOL;

    console.log(
      `${userName} Wallet Quote balance: ${userQuoteBalanceAmount} WSOL`
    );

    // console.log("Amount to swap: ", coinInAmount.toString());

    let poolAccount = await program.account.boundPool.fetch(poolPda);

    console.log("\n Pool info \n");

    let memeReserveAmount =
      Number(poolAccount.memeReserve.tokens) / LAMPORTS_PER_SOL;
    const formattedMemeReserve = formatBalanceInMillions(memeReserveAmount);

    console.log("Pool meme reserve: ", formattedMemeReserve);

    let quoteReserveAmount =
      Number(poolAccount.quoteReserve.tokens) / LAMPORTS_PER_SOL;

    console.log(`Pool quote reserve: ${quoteReserveAmount} WSOL`);

    return {
      userQuoteTokenAccount,
      userMemeTokenAccount,
      poolAccount,
    };
  }

  async function swapY(connection: any, wallet: Keypair, amount: number) {
    const coinXMinValue = new BN(0);
    let coinInAmount = new BN(amount * LAMPORTS_PER_SOL);

    const userMemeTokenAccount = await createTokenAccountMeme(
      connection,
      wallet,
      wallet.publicKey
    );
    const userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      wallet,
      wallet.publicKey
    );
    const feeQuoteVault = await createTokenAccountQuote(
      connection,
      wallet,
      BP_FEE_KEY_PUBKEY
    );

    await program.methods
      .swapY(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
        quoteVault: quoteVault.address,
        memeVault: memeVault.address,
        userMeme: userMemeTokenAccount.address,
        userSol: userQuoteTokenAccount.address,
        feeQuoteVault: feeQuoteVault.address,
      })
      .accountsPartial({
        owner: wallet.publicKey,
      })
      .signers([wallet])
      .rpc();
  }
  async function swapX(connection: any, wallet: Keypair, memeAmount: string) {
    const coinXMinValue = new BN(0);

    const userMemeTokenAccount = await createTokenAccountMeme(
      connection,
      wallet,
      wallet.publicKey
    );
    const userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      wallet,
      wallet.publicKey
    );
    const feeQuoteVault = await createTokenAccountQuote(
      connection,
      wallet,
      BP_FEE_KEY_PUBKEY
    );

    await program.methods
      .swapX(new BN(memeAmount), coinXMinValue)
      .accounts({
        pool: poolPda,
        quoteVault: quoteVault.address,
        memeVault: memeVault.address,
        userMeme: userMemeTokenAccount.address,
        userSol: userQuoteTokenAccount.address,
        feeQuoteVault: feeQuoteVault.address,
      })
      .accountsPartial({
        owner: wallet.publicKey,
      })
      .signers([wallet])
      .rpc();
  }

  before(async () => {
    const connection = provider.connection;
    const payer = (user as any).payer;

    memeMint = await createMemeMint();
    alice = await createFundedKeypair(100);
    bob = await createFundedKeypair(100);
    user2 = await createFundedKeypair(100);
    user3 = await createFundedKeypair(100);

    try {
      const targetAmount = new BN(55 * LAMPORTS_PER_SOL); // 2 SOL in lamports as BN

      const tx = await program.methods
        .initTargetConfig(targetAmount)
        .accounts({
          tokenMint: QUOTE_MINT, // ✅ Quote token (WSOL)
          pairTokenMint: memeMint, // ✅ Meme token
        })
        .rpc();
    } catch (error) {
      console.error("Error creating target config:", error);
      throw error;
    }

    targetConfigPda = getTargetConfigPda(memeMint)[0];

    // Step 6: Derive PDAs (these are automatic!)
    poolPda = getPoolPda(memeMint)[0];

    poolSigner = getPoolSignerPda(poolPda)[0];

    // Create quote vault token account(owned by pool signer PDA)
    quoteVault = await createTokenAccountQuote(
      connection,
      payer,
      poolSigner,
      true
    );

    // Create Associated Token Account for meme tokens (owned by pool signer)
    memeVault = await createTokenAccountMeme(
      connection,
      payer,
      poolSigner,
      true
    );

    try {
      const tx = await setAuthority(
        connection,
        payer,
        memeMint, // the mint account, not the vault
        payer, // current mint authority
        AuthorityType.MintTokens,
        poolSigner // new mint authority
      );
    } catch (error) {
      console.error("Error setting authority of meme mint:", error);
      throw error;
    }

    // // CREATE FEE FEE QUOTE VAULT

    // Create Associated Token Account for fee vault (owned by fee authority)
    const feeQuoteVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      QUOTE_MINT,
      BP_FEE_KEY_PUBKEY
    );

    // // CALL INITIALIZE_POOL
    try {
      console.log("Creating new pool...");
      const tx = await program.methods
        .newPool()
        .accounts({
          memeMint: memeMint,
          quoteVault: quoteVault.address,
          quoteMint: QUOTE_MINT,
          feeQuoteVault: feeQuoteVault.address,
          memeVault: memeVault.address,
          targetConfig: targetConfigPda,
        })
        .rpc();
      poolAccount = await program.account.boundPool.fetch(poolPda);
    } catch (error) {
      console.error("Error initializing pool:", error);
      throw error;
    }
  });
  it("the admin should get the fees", async () => {
    const connection = provider.connection;
    const payer = (user as any).payer;

    console.log("Admin Address", BP_FEE_KEY_PUBKEY.toBase58());
    console.log("\n Admin fees before swap \n");

    let amountToSwap = 50;

    let coinInAmount = new BN(amountToSwap * LAMPORTS_PER_SOL);
    let coinXMinValue = new BN(0);

    const swapYResult = await program.methods
      .getSwapYAmt(coinInAmount, coinXMinValue)
      .accounts({
        pool: poolPda,
      })
      .view();

    console.log("Swap Y Result:", swapYResult);
    console.log(
      "Amount In:",
      swapYResult.amountIn.toString() / LAMPORTS_PER_SOL
    );
    console.log(
      "Amount Out:",
      formatBalanceInMillions(Number(swapYResult.amountOut.toString()))
    );
    console.log(
      "Admin Fee In:",
      formatBalanceInMillions(Number(swapYResult.adminFeeIn.toString()))
    );
    console.log("Admin Fee Out:", swapYResult.adminFeeOut.toString());

    // Calculate fee percentage
    const feePercentage =
      (Number(swapYResult.adminFeeIn) / Number(coinInAmount)) * 100;
    console.log("Expected Fee Percentage:", feePercentage.toFixed(2) + "%");

    let userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      payer,
      BP_FEE_KEY_PUBKEY
    );

    let userQuoteBalanceAmount =
      Number(userQuoteTokenAccount.amount) / LAMPORTS_PER_SOL;

    console.log(`Admin Wallet Quote balance: ${userQuoteBalanceAmount} WSOL`);

    ///////////////////// ALICE /////////////////////
    // Amount to

    console.log("\nAlice before swap \n");
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Alice", alice, amountToSwap);

    await swapY(connection, alice, amountToSwap);

    console.log("\n Alice after swap \n");
    await userAndPoolInfo(connection, "Alice", alice);

    console.log("\n Admin fees after buying meme for wsol \n");

    userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      payer,
      BP_FEE_KEY_PUBKEY
    );

    userQuoteBalanceAmount =
      Number(userQuoteTokenAccount.amount) / LAMPORTS_PER_SOL;

    console.log(`Admin Wallet Quote balance: ${userQuoteBalanceAmount} WSOL`);

    /////////////////////// ALICE SELL //////////////////////
    console.log("\n Alice before sell \n");

    const { userMemeTokenAccount: aliceMemeTokenAccount2 } =
      await userAndPoolInfo(connection, "Alice", alice, 0);

    const memeAmount = await getAccount(
      connection,
      aliceMemeTokenAccount2.address
    );

    const formattedMemeAmount = formatBalanceInMillions(
      Number(memeAmount.amount) / LAMPORTS_PER_SOL
    );

    console.log(`\n Meme amount to Sell: ${formattedMemeAmount}`);

    await swapX(connection, alice, memeAmount.amount.toString());

    console.log("\n Alice after sell \n");
    await userAndPoolInfo(connection, "Alice", alice);

    console.log("\n Admin fees after selling meme for wsol \n");

    userQuoteTokenAccount = await createTokenAccountQuote(
      connection,
      payer,
      BP_FEE_KEY_PUBKEY
    );

    userQuoteBalanceAmount =
      Number(userQuoteTokenAccount.amount) / LAMPORTS_PER_SOL;

    console.log(`Admin Wallet Quote balance: ${userQuoteBalanceAmount} WSOL`);
  });
  it.skip("Alice should buy early and sell late for profit", async () => {
    const connection = provider.connection;
    const payer = (user as any).payer;
    // const coinXMinValue = new BN(0);

    ///////////////////// ALICE /////////////////////
    // Amount to
    let amountToSwap = 1;

    console.log("\nAlice before swap \n");
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    const { userMemeTokenAccount: aliceMemeTokenAccount } =
      await userAndPoolInfo(connection, "Alice", alice, amountToSwap);

    await swapY(connection, alice, amountToSwap);

    console.log("\n Alice after swap \n");
    await userAndPoolInfo(connection, "Alice", alice);

    // ///////////////////// BOB  /////////////////////
    console.log("\n Bob before swap \n");
    amountToSwap += 1;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Bob", bob, amountToSwap);

    await swapY(connection, bob, amountToSwap);

    console.log("\n Bob after swap \n");
    await userAndPoolInfo(connection, "Bob", bob);

    // ///////////////////// USER2  /////////////////////
    console.log("\n User2 before swap \n");
    amountToSwap += 1;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "User2", user2, amountToSwap);

    await swapY(connection, user2, amountToSwap);

    console.log("\n User2 after swap \n");
    await userAndPoolInfo(connection, "User2", user2);

    /////////////////////// ALICE SELL //////////////////////
    console.log("\n Alice before sell \n");

    const { userMemeTokenAccount: aliceMemeTokenAccount2 } =
      await userAndPoolInfo(connection, "Alice", alice, 0);

    const memeAmount = await getAccount(
      connection,
      aliceMemeTokenAccount2.address
    );

    const formattedMemeAmount = formatBalanceInMillions(
      Number(memeAmount.amount) / LAMPORTS_PER_SOL
    );

    console.log(`\n Meme amount to Sell: ${formattedMemeAmount}`);

    await swapX(connection, alice, memeAmount.amount.toString());

    console.log("\n Alice after sell \n");
    await userAndPoolInfo(connection, "Alice", alice);

    assert.isTrue(
      aliceMemeTokenAccount2.amount.toString() >
        aliceMemeTokenAccount.amount.toString(),
      "Alice meme token account after sell should be greater than initial buy"
    );
  });
  it("Scenario 2: Edge Case", async () => {
    console.log(
      "\n User2 and Bob sell meme tokens , and bob should get all the tokens in the meme reserve\n"
    );

    const connection = provider.connection;
    const payer = (user as any).payer;
    // const coinXMinValue = new BN(0);

    ///////////////////// BOB TO SELL  /////////////////////
    console.log("User2 Before Sell \n");
    let {
      userQuoteTokenAccount: user2QuoteTokenAccount,
      userMemeTokenAccount: user2MemeTokenAccount,
    } = await userAndPoolInfo(connection, "User2", user2);

    let memeAmount = await getAccount(
      connection,
      user2MemeTokenAccount.address
    );

    let formattedMemeAmount = formatBalanceInMillions(
      Number(memeAmount.amount) / LAMPORTS_PER_SOL
    );

    console.log(`\n Meme amount to Sell: ${formattedMemeAmount} \n`);

    await swapX(connection, user2, memeAmount.amount.toString());

    console.log("\n User2 after sell \n");
    await userAndPoolInfo(connection, "User2", user2);
    ///////////////////////////BOB TO SELL ///////////////////////////
    console.log("\n Bob Before Sell \n");
    const { userMemeTokenAccount: bobMemeTokenAccountBefore } =
      await userAndPoolInfo(connection, "Bob", bob);

    memeAmount = await getAccount(
      connection,
      bobMemeTokenAccountBefore.address
    );

    formattedMemeAmount = formatBalanceInMillions(
      Number(memeAmount.amount) / LAMPORTS_PER_SOL
    );

    console.log(`\n Meme amount to Sell: ${formattedMemeAmount} \n`);

    await swapX(connection, bob, memeAmount.amount.toString());

    console.log("\n Bob after sell \n");
    const {
      userMemeTokenAccount: bobMemeTokenAccountAfter,
      poolAccount: bobPoolAccountAfter,
    } = await userAndPoolInfo(connection, "Bob", bob);

    assert.equal(
      bobPoolAccountAfter.quoteReserve.tokens.toString(),
      "0",
      "Bob quote token account after sell should be equal to 0"
    );
  });
  it("Scenario 3 : User 3 Losses", async () => {
    const connection = provider.connection;
    const payer = (user as any).payer;

    ///////////////////// ALICE /////////////////////
    // Amount to
    let amountToSwap = 1;

    console.log("\nAlice before swap \n");
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Alice", alice, amountToSwap);

    await swapY(connection, alice, amountToSwap);

    console.log("\n Alice after swap \n");
    await userAndPoolInfo(connection, "Alice", alice);

    // ///////////////////// BOB  /////////////////////
    console.log("\n Bob before swap \n");
    amountToSwap += 1;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Bob", bob, amountToSwap);

    await swapY(connection, bob, amountToSwap);

    console.log("\n Bob after swap \n");
    await userAndPoolInfo(connection, "Bob", bob);

    // ///////////////////// USER2  /////////////////////
    console.log("\n User2 before swap \n");
    amountToSwap += 1;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "User2", user2, amountToSwap);

    await swapY(connection, user2, amountToSwap);

    console.log("\n User2 after swap \n");
    await userAndPoolInfo(connection, "User2", user2);

    /////////////////////// USER 3 //////////////////////
    console.log("\n User3 before swap \n");
    amountToSwap += 1;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "User3", user3, amountToSwap);

    await swapY(connection, user3, amountToSwap);

    console.log("\n User3 after swap \n");
    await userAndPoolInfo(connection, "User3", user3);

    /////////////////////// MULTIPLE SWAPS /////////////////////
    console.log("Selling Meme");

    /// ALICE
    console.log("\n Alice selling meme \n");
    const { userMemeTokenAccount: aliceMemeTokenAccountBefore } =
      await userAndPoolInfo(connection, "Alice", alice);

    await swapX(
      connection,
      alice,
      aliceMemeTokenAccountBefore.amount.toString()
    );

    /// BOB
    console.log("\n Bob selling meme \n");
    const { userMemeTokenAccount: bobMemeTokenAccountBefore } =
      await userAndPoolInfo(connection, "Bob", bob);

    await swapX(connection, bob, bobMemeTokenAccountBefore.amount.toString());

    /// USER 2
    console.log("\n User2 selling meme \n");

    const { userMemeTokenAccount: user2MemeTokenAccountBefore } =
      await userAndPoolInfo(connection, "User2", user2);

    await swapX(
      connection,
      user2,
      user2MemeTokenAccountBefore.amount.toString()
    );

    ///// USER 3
    console.log("\n User3 before swap \n");
    const { userMemeTokenAccount: user3MemeTokenAccountBefore } =
      await userAndPoolInfo(connection, "User3", user3);

    const user3MemeAmount = await getAccount(
      connection,
      user3MemeTokenAccountBefore.address
    );

    const formattedMemeAmount = formatBalanceInMillions(
      Number(user3MemeAmount.amount) / LAMPORTS_PER_SOL
    );

    console.log(`\n Meme amount to Sell: ${formattedMemeAmount} \n`);

    await swapX(connection, user3, user3MemeAmount.amount.toString());

    console.log("\n User3 after swap \n");
    await userAndPoolInfo(connection, "User3", user3);
  });
  it("Scenario 4: Edge Case", async () => {
    const connection = provider.connection;
    const payer = (user as any).payer;

    ///////////////////// ALICE /////////////////////
    // Amount to
    let amountToSwap = 54;

    console.log("\n Alice before swap \n");
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Alice", alice, amountToSwap);

    await swapY(connection, alice, amountToSwap);

    console.log("\n Alice after swap \n");
    await userAndPoolInfo(connection, "Alice", alice);

    ///////////////////// BOB /////////////////////
    console.log("\n Bob before swap \n");
    amountToSwap = 2;
    console.log(`Amount to Swap : ${amountToSwap} WSOL`);

    await userAndPoolInfo(connection, "Bob", bob, amountToSwap);

    await swapY(connection, bob, amountToSwap);

    console.log("\n Bob after swap \n");
    const { poolAccount: bobPoolAccountAfter } = await userAndPoolInfo(
      connection,
      "Bob",
      bob
    );

    console.log(
      "\n Pool Locked Status: ",
      bobPoolAccountAfter.locked.toString()
    );
  });
});
