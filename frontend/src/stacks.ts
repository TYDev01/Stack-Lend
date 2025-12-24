import {
  boolCV,
  cvToValue,
  deserializeCV,
  serializeCV,
  uintCV,
} from "@stacks/transactions";

export type Loan = {
  borrower: string;
  lender?: string;
  principal_is_stx: boolean;
  principal_amount: bigint;
  collateral_is_stx: boolean;
  collateral_amount: bigint;
  repay_amount: bigint;
  start_block: bigint;
  end_block: bigint;
  status: bigint;
};

export const STATUS = {
  OPEN: 0n,
  FUNDED: 1n,
  REPAID: 2n,
  DEFAULTED: 3n,
  CANCELLED: 4n,
};

export type ContractConfig = {
  address: string;
  name: string;
  apiUrl: string;
  readOnlySender: string;
};

export const createLoanArgs = (data: {
  loanId: number;
  principalIsStx: boolean;
  principalAmount: number;
  repayAmount: number;
  duration: number;
  collateralIsStx: boolean;
  collateralAmount: number;
}) => [
  uintCV(data.loanId),
  boolCV(data.principalIsStx),
  uintCV(data.principalAmount),
  uintCV(data.repayAmount),
  uintCV(data.duration),
  boolCV(data.collateralIsStx),
  uintCV(data.collateralAmount),
];

export const loanIdArg = (loanId: number) => [uintCV(loanId)];

export const callReadOnly = async (
  config: ContractConfig,
  functionName: string,
  args: ReturnType<typeof loanIdArg>
) => {
  const url = `${config.apiUrl}/v2/contracts/call-read/${config.address}/${config.name}/${functionName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: config.readOnlySender,
      arguments: args.map((arg) => serializeCV(arg)),
    }),
  });

  if (!response.ok) {
    throw new Error(`Read-only call failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Read-only error: ${payload.cause}`);
  }

  return cvToValue(deserializeCV(payload.result));
};
