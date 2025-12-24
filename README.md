# Stacks Lend

Peer-to-peer lending on Stacks with escrowed collateral and fixed-term repayment.
Supports two assets: STX and a single SIP-010 token (sBTC).

## Contracts

- `contracts/p2p-lending.clar`: loan lifecycle and escrow logic.
- `contracts/sbtc-token.clar`: mock SIP-010 token used in tests.

## Quick start

```bash
npm install
npm test
```

## Frontend

React + TypeScript UI with Reown AppKit for wallet connection.

```bash
cd frontend
npm install
npm run dev
```

Then visit `http://localhost:5173` and enter your deployed contract address.

## Usage notes

- The borrower escrows collateral when calling `create-loan`.
- The lender funds with `fund-loan`; the principal transfers immediately to the borrower.
- Repayment must happen on or before `end-block`; otherwise the lender can `claim-default`.
- Loans are indexed by ID; the frontend scans an ID range to list open loans.
