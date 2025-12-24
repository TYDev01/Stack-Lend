import { describe, expect, it } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

const CONTRACT = "p2p-lending";
const TOKEN = "sbtc-token";

const STATUS = {
  OPEN: 0n,
  FUNDED: 1n,
  REPAID: 2n,
  DEFAULTED: 3n,
  CANCELLED: 4n,
};

const getLoan = (loanId: number, sender: string) => {
  const result = simnet.callReadOnlyFn(
    CONTRACT,
    "get-loan",
    [Cl.uint(loanId)],
    sender
  );
  const value = cvToValue(result.result) as
    | Record<string, bigint>
    | { value: Record<string, bigint> }
    | null;
  if (value === null) {
    throw new Error("Loan not found");
  }
  return "value" in value ? value.value : value;
};

describe("p2p-lending", () => {
  it("runs a full happy path", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const borrower = accounts.get("wallet_1")!;
    const lender = accounts.get("wallet_2")!;

    let result = simnet.callPublicFn(
      TOKEN,
      "mint",
      [Cl.uint(1200), Cl.principal(lender.address)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));
    result = simnet.callPublicFn(
      TOKEN,
      "mint",
      [Cl.uint(200), Cl.principal(borrower.address)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "create-loan",
      [
        Cl.uint(1),
        Cl.bool(false),
        Cl.uint(1000),
        Cl.uint(1100),
        Cl.uint(10),
        Cl.bool(true),
        Cl.uint(500000),
      ],
      borrower
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "fund-loan",
      [Cl.uint(1)],
      lender
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "repay",
      [Cl.uint(1)],
      borrower
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const loan = getLoan(1, borrower.address);
    expect(loan.status).toBe(STATUS.REPAID);
  });

  it("supports a cancel path", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const borrower = accounts.get("wallet_3")!;

    let result = simnet.callPublicFn(
      TOKEN,
      "mint",
      [Cl.uint(600), Cl.principal(borrower.address)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "create-loan",
      [
        Cl.uint(2),
        Cl.bool(true),
        Cl.uint(150000),
        Cl.uint(165000),
        Cl.uint(20),
        Cl.bool(false),
        Cl.uint(500),
      ],
      borrower
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "cancel-loan",
      [Cl.uint(2)],
      borrower
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const loan = getLoan(2, borrower.address);
    expect(loan.status).toBe(STATUS.CANCELLED);
  });

  it("allows claiming default after the deadline", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const borrower = accounts.get("wallet_4")!;
    const lender = accounts.get("wallet_5")!;

    let result = simnet.callPublicFn(
      TOKEN,
      "mint",
      [Cl.uint(900), Cl.principal(borrower.address)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "create-loan",
      [
        Cl.uint(3),
        Cl.bool(true),
        Cl.uint(100000),
        Cl.uint(110000),
        Cl.uint(5),
        Cl.bool(false),
        Cl.uint(500),
      ],
      borrower
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      CONTRACT,
      "fund-loan",
      [Cl.uint(3)],
      lender
    );
    expect(result.result).toBeOk(Cl.bool(true));

    simnet.mineEmptyBlocks(6);

    result = simnet.callPublicFn(
      CONTRACT,
      "claim-default",
      [Cl.uint(3)],
      lender
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const loan = getLoan(3, borrower.address);
    expect(loan.status).toBe(STATUS.DEFAULTED);
  });
});
