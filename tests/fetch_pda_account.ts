import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { QUOTE_MINT } from "./config";
import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Launchpad } from "../target/types/launchpad";

// Derive the Target Config PDA
export function getTargetConfigPda(memeMint: PublicKey) {
  const program = anchor.workspace.Launchpad as Program<Launchpad>;

  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), QUOTE_MINT.toBuffer(), memeMint.toBuffer()],
    program.programId
  );
}

// Derive the Pool PDA
export function getPoolPda(memeMint: PublicKey) {
  const program = anchor.workspace.Launchpad as Program<Launchpad>;
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bound_pool"), memeMint.toBuffer(), QUOTE_MINT.toBuffer()],
    program.programId
  );
}

// Derive the Pool Signer PDA
export function getPoolSignerPda(poolPda: PublicKey) {
  const program = anchor.workspace.Launchpad as Program<Launchpad>;
  return PublicKey.findProgramAddressSync(
    [Buffer.from("signer"), poolPda.toBuffer()],
    program.programId
  );
}
