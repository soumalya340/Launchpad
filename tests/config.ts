import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const cpSwapProgram = new PublicKey(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);
export const configAddress = new PublicKey(
  "2fGXL8uhqxJ4tpgtosHZXT4zcQap6j62z3bMDxdkMvy5"
);
export const createPoolFee = new PublicKey(
  "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"
);

const BP_FEE_KEY_PUBKEY = new PublicKey(
  "7Z4GK4ouyzkqDcZU44FNBAGLfQTKkp6fwCUuzQcTKtJW"
);

export const QUOTE_MINT = NATIVE_MINT;

export { BP_FEE_KEY_PUBKEY };
