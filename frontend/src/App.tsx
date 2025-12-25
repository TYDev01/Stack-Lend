import { useMemo, useState } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { openContractCall } from "@stacks/connect";
import { AppConfig, UserSession } from "@stacks/connect";
import { StacksMainnet, StacksTestnet } from "@stacks/network";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  callReadOnly,
  createLoanArgs,
  loanIdArg,
  STATUS,
  type ContractConfig,
  type Loan,
} from "./stacks";
import { uintCV } from "@stacks/transactions";

const userSession = new UserSession({
  appConfig: new AppConfig(["store_write", "publish_data"]),
});

const defaultConfig: ContractConfig = {
  address: "",
  name: "p2p-lending",
  apiUrl: "https://api.testnet.hiro.so",
  readOnlySender: "",
};

const logLine = (message: string, current: string[]) => [
  `${new Date().toLocaleTimeString()} ${message}`,
  ...current,
].slice(0, 20);

const STATUS_LABELS: Record<string, string> = {
  [STATUS.OPEN.toString()]: "Open",
  [STATUS.FUNDED.toString()]: "Funded",
  [STATUS.REPAID.toString()]: "Repaid",
  [STATUS.DEFAULTED.toString()]: "Defaulted",
  [STATUS.CANCELLED.toString()]: "Cancelled",
};

type LoanSnapshot = {
  id: number;
  principal: string;
  collateral: string;
  repay: string;
  duration: string;
  status: bigint;
  borrower: string;
  lender?: string | null;
  endBlock: number;
};

const formatLoan = (loanId: number, loan: Loan): LoanSnapshot => ({
  id: loanId,
  principal: `${loan.principal_is_stx ? "STX" : "sBTC"} ${loan.principal_amount}`,
  collateral: `${loan.collateral_is_stx ? "STX" : "sBTC"} ${loan.collateral_amount}`,
  repay: `${loan.repay_amount}`,
  duration: `${loan.end_block}`,
  status: loan.status,
  borrower: loan.borrower,
  lender: loan.lender ?? null,
  endBlock: Number(loan.end_block),
});

const formatAddress = (value?: string | null) => {
  if (!value) return "—";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const normalizeAddress = (value?: string | null) => value?.toLowerCase() ?? "";

const callContract = async (
  config: ContractConfig,
  functionName: string,
  args: ReturnType<typeof loanIdArg>
) => {
  const network = config.apiUrl.includes("mainnet")
    ? new StacksMainnet()
    : new StacksTestnet();
  network.coreApiUrl = config.apiUrl;
  await openContractCall({
    contractAddress: config.address,
    contractName: config.name,
    functionName,
    functionArgs: args,
    userSession,
    network,
    postConditionMode: 1,
  });
};

const callCreate = async (config: ContractConfig, data: Parameters<typeof createLoanArgs>[0]) => {
  const network = config.apiUrl.includes("mainnet")
    ? new StacksMainnet()
    : new StacksTestnet();
  network.coreApiUrl = config.apiUrl;
  await openContractCall({
    contractAddress: config.address,
    contractName: config.name,
    functionName: "create-loan",
    functionArgs: createLoanArgs(data),
    userSession,
    network,
    postConditionMode: 1,
  });
};

export default function App() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const [config, setConfig] = useState(defaultConfig);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    `${new Date().toLocaleTimeString()} Ready. Connect a wallet to get started.`,
  ]);
  const [createForm, setCreateForm] = useState({
    loanId: 1,
    duration: 144,
    repayAmount: 1100,
    principalAmount: 1000,
    collateralAmount: 500000,
    principalIsStx: false,
    collateralIsStx: true,
  });
  const [manageLoanId, setManageLoanId] = useState(1);
  const [scanRange, setScanRange] = useState({ start: 1, end: 5 });
  const [scannedLoans, setScannedLoans] = useState<LoanSnapshot[]>([]);

  const canRead = useMemo(
    () =>
      config.address &&
      config.name &&
      config.apiUrl &&
      config.readOnlySender,
    [config]
  );

  const openLoans = useMemo(
    () => scannedLoans.filter((loan) => loan.status === STATUS.OPEN),
    [scannedLoans]
  );

  const borrowerLoans = useMemo(() => {
    if (!address) return scannedLoans;
    const normalized = normalizeAddress(address);
    return scannedLoans.filter(
      (loan) => normalizeAddress(loan.borrower) === normalized
    );
  }, [address, scannedLoans]);

  const lenderLoans = useMemo(() => {
    if (!address) {
      return scannedLoans.filter((loan) => Boolean(loan.lender));
    }
    const normalized = normalizeAddress(address);
    return scannedLoans.filter(
      (loan) => normalizeAddress(loan.lender) === normalized
    );
  }, [address, scannedLoans]);

  const buildDashboard = (loans: LoanSnapshot[]) => {
    const dueLoans =
      currentBlock > 0
        ? loans.filter(
            (loan) =>
              loan.status === STATUS.FUNDED && loan.endBlock <= currentBlock
          )
        : [];
    const activeLoans = loans.filter(
      (loan) =>
        loan.status === STATUS.FUNDED &&
        (currentBlock === 0 || loan.endBlock > currentBlock)
    );
    const defaultedLoans = loans.filter(
      (loan) => loan.status === STATUS.DEFAULTED
    );
    return { activeLoans, dueLoans, defaultedLoans };
  };

  const borrowerDashboard = useMemo(
    () => buildDashboard(borrowerLoans),
    [borrowerLoans, currentBlock]
  );

  const lenderDashboard = useMemo(
    () => buildDashboard(lenderLoans),
    [lenderLoans, currentBlock]
  );

  const statusBadgeClass = (status: bigint) => {
    switch (status) {
      case STATUS.OPEN:
        return "border-amber-200 bg-amber-50 text-amber-700";
      case STATUS.FUNDED:
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case STATUS.REPAID:
        return "border-sky-200 bg-sky-50 text-sky-700";
      case STATUS.DEFAULTED:
        return "border-rose-200 bg-rose-50 text-rose-700";
      case STATUS.CANCELLED:
        return "border-neutral-200 bg-neutral-100 text-neutral-600";
      default:
        return "";
    }
  };

  const renderLoanRows = (items: LoanSnapshot[], emptyLabel: string) => {
    if (!items.length) {
      return <p className="text-sm text-neutral-500">{emptyLabel}</p>;
    }

    return (
      <div className="space-y-3">
        {items.slice(0, 4).map((loan) => (
          <div
            key={loan.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white/90 p-3 text-sm"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Loan #{loan.id}</span>
                <Badge className={statusBadgeClass(loan.status)}>
                  {STATUS_LABELS[loan.status.toString()] ?? "Unknown"}
                </Badge>
              </div>
              <div className="text-xs text-neutral-500">
                Borrower {formatAddress(loan.borrower)} • Lender{" "}
                {formatAddress(loan.lender)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
              <Badge className="border-neutral-200 bg-neutral-50 text-neutral-600">
                Principal {loan.principal}
              </Badge>
              <Badge className="border-neutral-200 bg-neutral-50 text-neutral-600">
                Repay {loan.repay}
              </Badge>
              <Badge className="border-neutral-200 bg-neutral-50 text-neutral-600">
                End block {loan.endBlock}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const handleConnect = () => {
    open();
  };

  const handleCreate = async () => {
    if (!config.address) {
      setLogs((current) =>
        logLine("Enter contract address before creating a loan.", current)
      );
      return;
    }
    await callCreate(config, createForm);
    setLogs((current) => logLine("Create-loan submitted.", current));
  };

  const handleAction = async (action: string) => {
    if (!config.address) {
      setLogs((current) =>
        logLine("Enter contract address before submitting a transaction.", current)
      );
      return;
    }
    await callContract(config, action, loanIdArg(manageLoanId));
    setLogs((current) => logLine(`${action} submitted.`, current));
  };

  const handleScan = async () => {
    if (!canRead) {
      setLogs((current) =>
        logLine("Provide API URL, contract, and read-only sender.", current)
      );
      return;
    }

    const cards: LoanSnapshot[] = [];
    for (let id = scanRange.start; id <= scanRange.end; id += 1) {
      const result = await callReadOnly(config, "get-loan", [uintCV(id)]);
      if (result && typeof result === "object" && "value" in result) {
        const loan = (result as { value: Loan }).value;
        cards.push(formatLoan(id, loan));
      }
    }
    setScannedLoans(cards);
    setLogs((current) =>
      logLine(`Scanned loans ${scanRange.start} → ${scanRange.end}.`, current)
    );
  };

  return (
    <div className="page">
      <div className="glow" />
      <main className="container">
        <header className="hero">
          <div>
            <p className="eyebrow">P2P Lending on Stacks</p>
            <h1>Stacks Lend</h1>
            <p className="subtitle">
              Fixed-term loans using escrow. Pair STX with sBTC for clean,
              predictable deals.
            </p>
          </div>
          <div className="hero-card">
            <p className="meta">Network</p>
            <div className="row">
              <label className="label">API base URL</label>
              <input
                value={config.apiUrl}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    apiUrl: event.target.value,
                  }))
                }
              />
            </div>
            <div className="row">
              <label className="label">Contract address</label>
              <input
                placeholder="ST... or SP..."
                value={config.address}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
              />
            </div>
            <div className="row">
              <label className="label">Contract name</label>
              <input
                value={config.name}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="row">
              <label className="label">Read-only sender</label>
              <input
                placeholder="ST... or SP..."
                value={config.readOnlySender}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    readOnlySender: event.target.value,
                  }))
                }
              />
            </div>
            <div className="row">
              <label className="label">Current block height (optional)</label>
              <input
                type="number"
                min={0}
                value={currentBlock || ""}
                onChange={(event) => setCurrentBlock(Number(event.target.value))}
              />
            </div>
            <button className="primary" onClick={handleConnect}>
              {isConnected ? `Connected: ${address}` : "Connect Wallet"}
            </button>
          </div>
        </header>

        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Dashboards</p>
              <h2 className="mb-2">Borrower + Lender Overview</h2>
              <p className="subtitle small">
                Track active positions, repayment pressure, and defaults from the
                latest scan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-neutral-200 bg-white">
                Scanned loans {scannedLoans.length}
              </Badge>
              <Badge className="border-neutral-200 bg-white">
                Current block {currentBlock || "Not set"}
              </Badge>
              <Badge className="border-neutral-200 bg-white">
                {address ? "Filtered to wallet" : "Connect wallet for filtering"}
              </Badge>
            </div>
          </div>
          <Tabs defaultValue="borrower" className="w-full">
            <TabsList>
              <TabsTrigger value="borrower">Borrower</TabsTrigger>
              <TabsTrigger value="lender">Lender</TabsTrigger>
            </TabsList>
            <TabsContent value="borrower">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Active Loans</CardTitle>
                    <CardDescription>Funded loans currently in flight.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {borrowerDashboard.activeLoans.length}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Repayments Due</CardTitle>
                    <CardDescription>
                      Set current block height to detect overdue loans.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {borrowerDashboard.dueLoans.length}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Defaults</CardTitle>
                    <CardDescription>Loans marked as defaulted.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {borrowerDashboard.defaultedLoans.length}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Active Loans</CardTitle>
                    <CardDescription>Borrower view of funded loans.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderLoanRows(
                      borrowerDashboard.activeLoans,
                      "No active loans yet."
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Repayment Pressure</CardTitle>
                    <CardDescription>Funded loans at or past end block.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderLoanRows(
                      borrowerDashboard.dueLoans,
                      currentBlock
                        ? "No repayments due."
                        : "Add a current block to compute due loans."
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Defaults</CardTitle>
                    <CardDescription>Borrower loans in default.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderLoanRows(
                      borrowerDashboard.defaultedLoans,
                      "No defaulted loans."
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="lender">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Active Loans</CardTitle>
                    <CardDescription>Capital currently deployed.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {lenderDashboard.activeLoans.length}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Repayments Due</CardTitle>
                    <CardDescription>Loans at or past end block.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {lenderDashboard.dueLoans.length}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Defaults</CardTitle>
                    <CardDescription>Loans with collateral claim pending.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">
                      {lenderDashboard.defaultedLoans.length}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Active Loans</CardTitle>
                    <CardDescription>Lender view of funded loans.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderLoanRows(
                      lenderDashboard.activeLoans,
                      "No active loans yet."
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Defaults</CardTitle>
                    <CardDescription>Defaulted loans for recovery.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {renderLoanRows(
                      lenderDashboard.defaultedLoans,
                      "No defaulted loans."
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <section className="grid">
          <article className="panel">
            <h2>Create Loan</h2>
            <div className="panel-grid">
              <label>
                Loan ID
                <input
                  type="number"
                  min={0}
                  value={createForm.loanId}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      loanId: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Duration (blocks)
                <input
                  type="number"
                  min={1}
                  value={createForm.duration}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      duration: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Repay amount
                <input
                  type="number"
                  min={1}
                  value={createForm.repayAmount}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      repayAmount: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Principal amount
                <input
                  type="number"
                  min={1}
                  value={createForm.principalAmount}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      principalAmount: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Collateral amount
                <input
                  type="number"
                  min={1}
                  value={createForm.collateralAmount}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      collateralAmount: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
            <div className="toggle-group">
              <div>
                <p className="label">Principal asset</p>
                <label className="chip">
                  <input
                    type="radio"
                    name="principalAsset"
                    checked={!createForm.principalIsStx}
                    onChange={() =>
                      setCreateForm((current) => ({
                        ...current,
                        principalIsStx: false,
                      }))
                    }
                  />
                  sBTC
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="principalAsset"
                    checked={createForm.principalIsStx}
                    onChange={() =>
                      setCreateForm((current) => ({
                        ...current,
                        principalIsStx: true,
                      }))
                    }
                  />
                  STX
                </label>
              </div>
              <div>
                <p className="label">Collateral asset</p>
                <label className="chip">
                  <input
                    type="radio"
                    name="collateralAsset"
                    checked={createForm.collateralIsStx}
                    onChange={() =>
                      setCreateForm((current) => ({
                        ...current,
                        collateralIsStx: true,
                      }))
                    }
                  />
                  STX
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="collateralAsset"
                    checked={!createForm.collateralIsStx}
                    onChange={() =>
                      setCreateForm((current) => ({
                        ...current,
                        collateralIsStx: false,
                      }))
                    }
                  />
                  sBTC
                </label>
              </div>
            </div>
            <button className="primary" onClick={handleCreate}>
              Create loan
            </button>
            <p className="hint">Collateral is escrowed in the contract on create.</p>
          </article>

          <article className="panel">
            <h2>Manage Loans</h2>
            <div className="panel-grid">
              <label>
                Loan ID
                <input
                  type="number"
                  min={0}
                  value={manageLoanId}
                  onChange={(event) => setManageLoanId(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="action-row">
              <button onClick={() => handleAction("fund-loan")}>Fund loan</button>
              <button onClick={() => handleAction("repay")}>Repay</button>
              <button onClick={() => handleAction("claim-default")}>
                Claim default
              </button>
              <button className="ghost" onClick={() => handleAction("cancel-loan")}>
                Cancel
              </button>
            </div>
            <p className="hint">
              Funding sends the principal to escrow and immediately releases it to
              the borrower.
            </p>
          </article>

          <article className="panel wide">
            <div className="panel-header">
              <div>
                <h2>Open Loans</h2>
                <p className="subtitle small">
                  Scan a range of loan IDs and list OPEN loans.
                </p>
              </div>
              <div className="panel-grid compact">
                <label>
                  Start ID
                  <input
                    type="number"
                    min={0}
                    value={scanRange.start}
                    onChange={(event) =>
                      setScanRange((current) => ({
                        ...current,
                        start: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  End ID
                  <input
                    type="number"
                    min={0}
                    value={scanRange.end}
                    onChange={(event) =>
                      setScanRange((current) => ({
                        ...current,
                        end: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <button className="primary" onClick={handleScan}>
                  Scan
                </button>
              </div>
            </div>
            <div className="loan-list">
              {openLoans.length ? (
                openLoans.map((loan) => (
                  <div className="loan-card" key={loan.id}>
                    <strong>Loan #{loan.id}</strong>
                    <span className="loan-tag">Principal: {loan.principal}</span>
                    <span className="loan-tag">Collateral: {loan.collateral}</span>
                    <span className="loan-tag">Repay: {loan.repay}</span>
                    <span className="loan-tag">Duration: {loan.duration}</span>
                  </div>
                ))
              ) : (
                <p className="hint">No open loans yet.</p>
              )}
            </div>
          </article>
        </section>

        <section className="panel log-panel">
          <h2>Activity Log</h2>
          <pre className="log">{logs.join("\n")}</pre>
        </section>
      </main>
    </div>
  );
}
