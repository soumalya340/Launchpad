# SOLANA TESTING SETUP - STEP BY STEP GUIDE

## Prerequisites
- Solana CLI installed
- Anchor framework installed
- Access to mainnet-beta for program dumping

## Program Addresses
- **MPL Metadata**: `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`
- **Raydium CPMM**: `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`
- **Raydium AMM**: `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2`
- **Raydium FeeReceiver**: `DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8`

## Step-by-Step Process

### Step 1: Download Required Programs
Download the necessary programs from mainnet to use in your local test validator:

```bash
# Download MPL Metadata program
solana program dump -u mainnet-beta metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/programs/mpl-metadata.so

# Download Raydium CPMM program
solana program dump -u mainnet-beta CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C tests/programs/raydium-cpmm.so

```

### Step 2: Start Test Validator (Choose One Option)

```bash
solana-test-validator \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/programs/mpl-metadata.so \
  --bpf-program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C tests/programs/raydium-cpmm.so \
  --clone D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --url mainnet-beta
```

```

### Step 3: Run Tests
Once your test validator is running, execute your Anchor tests:

```bash
anchor test --skip-local-validator
```

## Notes
- Use `--clone` to copy accounts and their data from mainnet
- Use `--bpf-program` to load downloaded program files
- Use `--reset` to start with a clean slate
- The `--skip-local-validator` flag assumes you're already running a test validator
