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

const BLOCKS_PER_YEAR = 52560;

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

const parseAsset = (value: string) => (value.includes("STX") ? "stx" : "sbtc");

const calculateApr = (loanSource: Loan) => {
  const principal = Number(loanSource.principal_amount);
  const repay = Number(loanSource.repay_amount);
  const startBlock = Number(loanSource.start_block);
  const endBlock = Number(loanSource.end_block);
  const duration = endBlock - startBlock;
  if (!principal || duration <= 0 || repay <= principal) return 0;
  const interest = (repay - principal) / principal;
  return (interest * (BLOCKS_PER_YEAR / duration)) * 100;
};

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
  const [reminderWindow, setReminderWindow] = useState(50);
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
  const [loanSources, setLoanSources] = useState<Record<number, Loan>>({});
  const [statusFilter, setStatusFilter] = useState("open");
  const [assetFilter, setAssetFilter] = useState("all");
  const [aprFilter, setAprFilter] = useState({ min: "", max: "" });
  const [durationFilter, setDurationFilter] = useState({ min: "", max: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const canRead = useMemo(
    () =>
      config.address &&
      config.name &&
      config.apiUrl &&
      config.readOnlySender,
    [config]
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

  const filteredLoans = useMemo(() => {
    const minApr = aprFilter.min ? Number(aprFilter.min) : null;
    const maxApr = aprFilter.max ? Number(aprFilter.max) : null;
    const minDuration = durationFilter.min ? Number(durationFilter.min) : null;
    const maxDuration = durationFilter.max ? Number(durationFilter.max) : null;

    return scannedLoans.filter((loan) => {
      if (statusFilter !== "all") {
        const label = STATUS_LABELS[loan.status.toString()]?.toLowerCase();
        if (label !== statusFilter) return false;
      }

      if (assetFilter !== "all") {
        const principalAsset = parseAsset(loan.principal);
        const collateralAsset = parseAsset(loan.collateral);
        if (assetFilter === "principal-stx" && principalAsset !== "stx") return false;
        if (assetFilter === "principal-sbtc" && principalAsset !== "sbtc") return false;
        if (assetFilter === "collateral-stx" && collateralAsset !== "stx") return false;
        if (assetFilter === "collateral-sbtc" && collateralAsset !== "sbtc") return false;
      }

      const source = loanSources[loan.id];
      const durationValue = source
        ? Number(source.end_block) - Number(source.start_block)
        : loan.endBlock;
      if (minDuration !== null && durationValue < minDuration) return false;
      if (maxDuration !== null && durationValue > maxDuration) return false;

      if (source) {
        const aprValue = calculateApr(source);
        if (minApr !== null && aprValue < minApr) return false;
        if (maxApr !== null && aprValue > maxApr) return false;
      }

      return true;
    });
  }, [aprFilter, assetFilter, durationFilter, loanSources, scannedLoans, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / pageSize));
  const pagedLoans = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLoans.slice(start, start + pageSize);
  }, [filteredLoans, page, pageSize]);

  const reminders = useMemo(() => {
    if (currentBlock === 0) {
      return [];
    }
    const windowSize = Math.max(0, reminderWindow);
    const upcomingLoans = scannedLoans.filter((loan) => {
      if (loan.status !== STATUS.FUNDED) return false;
      const delta = loan.endBlock - currentBlock;
      return delta > 0 && delta <= windowSize;
    });
    const overdueLoans = scannedLoans.filter(
      (loan) => loan.status === STATUS.FUNDED && loan.endBlock <= currentBlock
    );

    const upcomingBorrower = upcomingLoans.filter((loan) =>
      address ? normalizeAddress(loan.borrower) === normalizeAddress(address) : true
    );
    const upcomingLender = upcomingLoans.filter((loan) =>
      address ? normalizeAddress(loan.lender) === normalizeAddress(address) : true
    );
    const overdueBorrower = overdueLoans.filter((loan) =>
      address ? normalizeAddress(loan.borrower) === normalizeAddress(address) : true
    );
    const overdueLender = overdueLoans.filter((loan) =>
      address ? normalizeAddress(loan.lender) === normalizeAddress(address) : true
    );

    const items: { id: string; message: string; tone: string }[] = [];
    upcomingBorrower.forEach((loan) => {
      items.push({
        id: `borrower-upcoming-${loan.id}`,
        message: `Borrower reminder: Loan #${loan.id} ends in ${
          loan.endBlock - currentBlock
        } blocks.`,
        tone: "border-amber-200 bg-amber-50 text-amber-700",
      });
    });
    upcomingLender.forEach((loan) => {
      items.push({
        id: `lender-upcoming-${loan.id}`,
        message: `Lender heads-up: Loan #${loan.id} ends in ${
          loan.endBlock - currentBlock
        } blocks.`,
        tone: "border-sky-200 bg-sky-50 text-sky-700",
      });
    });
    overdueBorrower.forEach((loan) => {
      items.push({
        id: `borrower-overdue-${loan.id}`,
        message: `Borrower alert: Loan #${loan.id} is past due.`,
        tone: "border-rose-200 bg-rose-50 text-rose-700",
      });
    });
    overdueLender.forEach((loan) => {
      items.push({
        id: `lender-overdue-${loan.id}`,
        message: `Lender alert: Loan #${loan.id} is past due.`,
        tone: "border-rose-200 bg-rose-50 text-rose-700",
      });
    });

    return items;
  }, [address, currentBlock, reminderWindow, scannedLoans]);

  const pushReminder = (message: string) => {
    setLogs((current) => logLine(`Reminder queued: ${message}`, current));
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
    const sources: Record<number, Loan> = {};
    for (let id = scanRange.start; id <= scanRange.end; id += 1) {
      const result = await callReadOnly(config, "get-loan", [uintCV(id)]);
      if (result && typeof result === "object" && "value" in result) {
        const loan = (result as { value: Loan }).value;
        cards.push(formatLoan(id, loan));
        sources[id] = loan;
      }
    }
    setScannedLoans(cards);
    setLoanSources(sources);
    setLogs((current) =>
      logLine(`Scanned loans ${scanRange.start} → ${scanRange.end}.`, current)
    );
    setPage(1);
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

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Wallet-Based Notifications</CardTitle>
              <CardDescription>
                Create reminders for upcoming end-block deadlines based on the latest scan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[200px]">
                  <label className="label">Reminder window (blocks)</label>
                  <input
                    type="number"
                    min={0}
                    value={reminderWindow}
                    onChange={(event) => setReminderWindow(Number(event.target.value))}
                  />
                </div>
                <Badge className="border-neutral-200 bg-white">
                  Current block {currentBlock || "Not set"}
                </Badge>
                <Badge className="border-neutral-200 bg-white">
                  {address ? "Filtered to wallet" : "Connect wallet for targeting"}
                </Badge>
              </div>
              <div className="mt-4 space-y-2">
                {reminders.length ? (
                  reminders.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white/90 p-3 text-sm"
                    >
                      <Badge className={item.tone}>{item.message}</Badge>
                      <button
                        className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
                        onClick={() => pushReminder(item.message)}
                      >
                        Add to activity log
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">
                    No upcoming reminders yet. Set current block and scan loans to populate
                    alerts.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reminder Summary</CardTitle>
              <CardDescription>Quick totals for your wallet view.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Upcoming</span>
                  <span className="font-semibold">
                    {reminders.filter((item) => item.id.includes("upcoming")).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Overdue</span>
                  <span className="font-semibold">
                    {reminders.filter((item) => item.id.includes("overdue")).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Total reminders</span>
                  <span className="font-semibold">{reminders.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
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
                <h2>Loan Explorer</h2>
                <p className="subtitle small">
                  Scan a range of loan IDs, then filter by asset, status, APR, or duration.
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
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="funded">Funded</option>
                  <option value="repaid">Repaid</option>
                  <option value="defaulted">Defaulted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Asset
                <select
                  value={assetFilter}
                  onChange={(event) => {
                    setAssetFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All</option>
                  <option value="principal-stx">Principal: STX</option>
                  <option value="principal-sbtc">Principal: sBTC</option>
                  <option value="collateral-stx">Collateral: STX</option>
                  <option value="collateral-sbtc">Collateral: sBTC</option>
                </select>
              </label>
              <label>
                APR min/max (%)
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={aprFilter.min}
                    onChange={(event) => {
                      setAprFilter((current) => ({
                        ...current,
                        min: event.target.value,
                      }));
                      setPage(1);
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={aprFilter.max}
                    onChange={(event) => {
                      setAprFilter((current) => ({
                        ...current,
                        max: event.target.value,
                      }));
                      setPage(1);
                    }}
                  />
                </div>
              </label>
              <label>
                Duration min/max (blocks)
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={durationFilter.min}
                    onChange={(event) => {
                      setDurationFilter((current) => ({
                        ...current,
                        min: event.target.value,
                      }));
                      setPage(1);
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={durationFilter.max}
                    onChange={(event) => {
                      setDurationFilter((current) => ({
                        ...current,
                        max: event.target.value,
                      }));
                      setPage(1);
                    }}
                  />
                </div>
              </label>
            </div>
            <div className="loan-list">
              {pagedLoans.length ? (
                pagedLoans.map((loan) => {
                  const source = loanSources[loan.id];
                  const aprValue = source ? calculateApr(source) : 0;
                  return (
                  <div className="loan-card" key={loan.id}>
                    <strong>Loan #{loan.id}</strong>
                    <span className="loan-tag">
                      Status: {STATUS_LABELS[loan.status.toString()] ?? "Unknown"}
                    </span>
                    <span className="loan-tag">Principal: {loan.principal}</span>
                    <span className="loan-tag">Collateral: {loan.collateral}</span>
                    <span className="loan-tag">Repay: {loan.repay}</span>
                    <span className="loan-tag">Duration: {loan.duration}</span>
                    <span className="loan-tag">
                      APR: {aprValue ? `${aprValue.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  );
                })
              ) : (
                <p className="hint">No loans match the current filters.</p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                Showing {pagedLoans.length} of {filteredLoans.length}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-neutral-500">
                  Page size
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={4}>4</option>
                    <option value={6}>6</option>
                    <option value={9}>9</option>
                  </select>
                </label>
                <button
                  className="ghost"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                >
                  Prev
                </button>
                <span className="text-sm text-neutral-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="ghost"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={page === totalPages}
                >
                  Next
                </button>
              </div>
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
