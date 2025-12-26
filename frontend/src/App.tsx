import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { openContractCall } from "@stacks/connect";
import { AppConfig, UserSession } from "@stacks/connect";
import { StacksMainnet, StacksTestnet } from "@stacks/network";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useWallet } from "./wallet";
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
const APR_PRESETS = [
  { label: "6% APR", value: 6 },
  { label: "10% APR", value: 10 },
  { label: "15% APR", value: 15 },
  { label: "25% APR", value: 25 },
];
const COLLATERAL_PRESETS = [
  { label: "120% collateral", value: 1.2 },
  { label: "150% collateral", value: 1.5 },
  { label: "200% collateral", value: 2 },
];
const LOAN_INDEX_STORAGE_KEY = "stacks-lend:indexed-loans";

type TokenMeta = {
  id: string;
  symbol: string;
  name: string;
  contract: string;
  decimals: number;
};

const DEFAULT_TOKENS: TokenMeta[] = [
  {
    id: "sbtc",
    symbol: "sBTC",
    name: "sBTC",
    contract: "SP000000000000000000002Q6VF78.sbtc-token",
    decimals: 8,
  },
];

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
  principalIsStx: boolean;
  collateralIsStx: boolean;
};

type ToastItem = {
  id: number;
  title: string;
  message: string;
  tone: "info" | "success" | "error";
};

type CsvRow = Record<string, string | number>;

const formatLoan = (
  loanId: number,
  loan: Loan,
  tokenLabel: string
): LoanSnapshot => ({
  id: loanId,
  principal: `${loan.principal_is_stx ? "STX" : tokenLabel} ${loan.principal_amount}`,
  collateral: `${loan.collateral_is_stx ? "STX" : tokenLabel} ${loan.collateral_amount}`,
  repay: `${loan.repay_amount}`,
  duration: `${loan.end_block}`,
  status: loan.status,
  borrower: loan.borrower,
  lender: loan.lender ?? null,
  endBlock: Number(loan.end_block),
  principalIsStx: loan.principal_is_stx,
  collateralIsStx: loan.collateral_is_stx,
});

const formatAddress = (value?: string | null) => {
  if (!value) return "—";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const normalizeAddress = (value?: string | null) => value?.toLowerCase() ?? "";

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

const calcRepayFromApr = (principal: number, apr: number, duration: number) => {
  if (!principal || !apr || !duration) return principal;
  const interest = (apr / 100) * (duration / BLOCKS_PER_YEAR);
  return Math.max(0, Math.round(principal * (1 + interest)));
};

const calcCollateralFromRatio = (principal: number, ratio: number) => {
  if (!principal || !ratio) return principal;
  return Math.max(0, Math.round(principal * ratio));
};

const loadIndexedLoanIds = () => {
  try {
    const stored = localStorage.getItem(LOAN_INDEX_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "number" && id > 0);
  } catch {
    return [];
  }
};

const toCsv = (rows: CsvRow[]) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(
      headers
        .map((key) => {
          const raw = row[key] ?? "";
          const escaped = String(raw).replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(",")
    );
  });
  return lines.join("\n");
};


const downloadCsv = (filename: string, rows: CsvRow[]) => {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const { address, isConnected, connect, isConnecting, chainId } = useWallet();
  const location = useLocation();
  const [config, setConfig] = useState(defaultConfig);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [reminderWindow, setReminderWindow] = useState(50);
  const [logs, setLogs] = useState<string[]>([
    `${new Date().toLocaleTimeString()} Ready. Connect a wallet to get started.`,
  ]);
  const [tokens, setTokens] = useState<TokenMeta[]>(DEFAULT_TOKENS);
  const [defaultTokenId, setDefaultTokenId] = useState(DEFAULT_TOKENS[0]?.id ?? "");
  const [selectedPrincipalTokenId, setSelectedPrincipalTokenId] = useState(
    DEFAULT_TOKENS[0]?.id ?? ""
  );
  const [selectedCollateralTokenId, setSelectedCollateralTokenId] = useState(
    DEFAULT_TOKENS[0]?.id ?? ""
  );
  const [tokenDraft, setTokenDraft] = useState({
    symbol: "",
    name: "",
    contract: "",
    decimals: 8,
  });
  const [indexedLoanIds, setIndexedLoanIds] = useState<number[]>(() =>
    loadIndexedLoanIds()
  );
  const [indexerInput, setIndexerInput] = useState("");
  const [indexerImport, setIndexerImport] = useState("");
  const [indexerAddScan, setIndexerAddScan] = useState(true);
  const [calcInput, setCalcInput] = useState({
    principal: 1000,
    repay: 1100,
    duration: 144,
    blocksPerYear: BLOCKS_PER_YEAR,
  });
  const [createForm, setCreateForm] = useState({
    loanId: 1,
    duration: 144,
    repayAmount: 1100,
    principalAmount: 1000,
    collateralAmount: 500000,
    principalIsStx: false,
    collateralIsStx: true,
  });
  const [aprPreset, setAprPreset] = useState(APR_PRESETS[1].value);
  const [collateralPreset, setCollateralPreset] = useState(COLLATERAL_PRESETS[1].value);
  const [autoApplyPresets, setAutoApplyPresets] = useState(true);
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
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [lastActionAt, setLastActionAt] = useState(0);
  const [cooldownMs, setCooldownMs] = useState(2000);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(import.meta.env.DEV);
  const [diagLoanId, setDiagLoanId] = useState(1);
  const [diagResult, setDiagResult] = useState<string>("");

  const defaultToken = useMemo(
    () => tokens.find((token) => token.id === defaultTokenId) ?? tokens[0],
    [defaultTokenId, tokens]
  );

  const selectedPrincipalToken = useMemo(
    () => tokens.find((token) => token.id === selectedPrincipalTokenId) ?? defaultToken,
    [defaultToken, selectedPrincipalTokenId, tokens]
  );

  const selectedCollateralToken = useMemo(
    () => tokens.find((token) => token.id === selectedCollateralTokenId) ?? defaultToken,
    [defaultToken, selectedCollateralTokenId, tokens]
  );

  const createErrors = useMemo(() => {
    const errors: string[] = [];
    if (createForm.loanId <= 0) errors.push("Loan ID must be greater than zero.");
    if (createForm.duration <= 0) errors.push("Duration must be greater than zero.");
    if (createForm.principalAmount <= 0) errors.push("Principal must be greater than zero.");
    if (createForm.collateralAmount <= 0) errors.push("Collateral must be greater than zero.");
    if (createForm.repayAmount < createForm.principalAmount) {
      errors.push("Repay amount must be >= principal.");
    }
    if (createForm.principalIsStx === createForm.collateralIsStx) {
      errors.push("Principal and collateral must be different assets.");
    }
    return errors;
  }, [createForm]);

  const manageErrors = useMemo(() => {
    const errors: string[] = [];
    if (manageLoanId <= 0) errors.push("Loan ID must be greater than zero.");
    return errors;
  }, [manageLoanId]);

  const scanErrors = useMemo(() => {
    const errors: string[] = [];
    if (scanRange.start <= 0 || scanRange.end <= 0) {
      errors.push("Scan IDs must be greater than zero.");
    }
    if (scanRange.start > scanRange.end) {
      errors.push("Start ID must be <= End ID.");
    }
    return errors;
  }, [scanRange]);

  const isCooldownActive = Date.now() - lastActionAt < cooldownMs;

  const isDashboard = location.pathname === "/";
  const isLoans = location.pathname === "/loans";
  const isAdmin = location.pathname === "/admin";

  const expectedChainId = config.apiUrl.includes("mainnet")
    ? "stacks:mainnet"
    : "stacks:testnet";
  const hasChainMismatch = Boolean(chainId && chainId !== expectedChainId);

  const pushToast = (title: string, message: string, tone: ToastItem["tone"]) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, title, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6000);
  };

  const repaymentSummary = useMemo(() => {
    const principal = calcInput.principal;
    const repay = calcInput.repay;
    const duration = calcInput.duration;
    const blocksPerYear = calcInput.blocksPerYear || BLOCKS_PER_YEAR;
    if (!principal || !repay || !duration) {
      return null;
    }
    const interest = Math.max(0, repay - principal);
    const interestRate = interest / principal;
    const apr = (interestRate * (blocksPerYear / duration)) * 100;
    const perBlock = interest / duration;
    const checkpoints = [0.25, 0.5, 0.75, 1].map((ratio) => {
      const block = Math.round(duration * ratio);
      const accrued = Math.round(perBlock * block);
      return {
        label: `${Math.round(ratio * 100)}%`,
        block,
        accrued,
        totalDue: principal + accrued,
      };
    });

    return {
      interest,
      apr,
      perBlock,
      totalDue: repay,
      checkpoints,
    };
  }, [calcInput]);

  useEffect(() => {
    localStorage.setItem(LOAN_INDEX_STORAGE_KEY, JSON.stringify(indexedLoanIds));
  }, [indexedLoanIds]);

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

  const borrowerReputation = useMemo(() => {
    const total = borrowerLoans.length;
    const repaid = borrowerLoans.filter((loan) => loan.status === STATUS.REPAID).length;
    const defaulted = borrowerLoans.filter((loan) => loan.status === STATUS.DEFAULTED).length;
    const active = borrowerLoans.filter((loan) => loan.status === STATUS.FUNDED).length;
    const settled = repaid + defaulted;
    const repaymentRate = settled ? Math.round((repaid / settled) * 100) : 0;
    return { total, repaid, defaulted, active, repaymentRate };
  }, [borrowerLoans]);

  const lenderRisk = useMemo(() => {
    const total = lenderLoans.length;
    const repaid = lenderLoans.filter((loan) => loan.status === STATUS.REPAID).length;
    const defaulted = lenderLoans.filter((loan) => loan.status === STATUS.DEFAULTED).length;
    const settled = repaid + defaulted;
    const defaultRate = settled ? Math.round((defaulted / settled) * 100) : 0;
    const ratios = lenderLoans
      .map((loan) => {
        const source = loanSources[loan.id];
        if (!source || !Number(source.principal_amount)) return null;
        return Number(source.collateral_amount) / Number(source.principal_amount);
      })
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const avgCollateralRatio =
      ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0;
    return { total, repaid, defaulted, defaultRate, avgCollateralRatio };
  }, [lenderLoans, loanSources]);

  const riskLabel = (ratio: number) => {
    if (!ratio) return "Unknown";
    if (ratio < 1.2) return "High risk";
    if (ratio < 1.5) return "Moderate risk";
    return "Low risk";
  };

  const statusBadgeClass = (status: bigint) => {
    switch (status) {
      case STATUS.OPEN:
        return "border-amber-500/40 bg-amber-900/40 text-amber-200";
      case STATUS.FUNDED:
        return "border-emerald-500/40 bg-emerald-900/40 text-emerald-200";
      case STATUS.REPAID:
        return "border-sky-500/40 bg-sky-900/40 text-sky-200";
      case STATUS.DEFAULTED:
        return "border-rose-500/40 bg-rose-900/40 text-rose-200";
      case STATUS.CANCELLED:
        return "border-slate-700 bg-slate-800 text-slate-300";
      default:
        return "";
    }
  };

  const renderLoanRows = (items: LoanSnapshot[], emptyLabel: string) => {
    if (!items.length) {
      return <p className="text-sm text-slate-400">{emptyLabel}</p>;
    }

    return (
      <div className="space-y-3">
        {items.slice(0, 4).map((loan) => (
          <div
            key={loan.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-sm"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Loan #{loan.id}</span>
                <Badge className={statusBadgeClass(loan.status)}>
                  {STATUS_LABELS[loan.status.toString()] ?? "Unknown"}
                </Badge>
              </div>
              <div className="text-xs text-slate-400">
                Borrower {formatAddress(loan.borrower)} • Lender{" "}
                {formatAddress(loan.lender)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                Principal {loan.principal}
              </Badge>
              <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                Repay {loan.repay}
              </Badge>
              <Badge className="border-slate-700 bg-slate-800 text-slate-300">
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
        if (assetFilter === "principal-stx" && !loan.principalIsStx) return false;
        if (assetFilter === "principal-token" && loan.principalIsStx) return false;
        if (assetFilter === "collateral-stx" && !loan.collateralIsStx) return false;
        if (assetFilter === "collateral-token" && loan.collateralIsStx) return false;
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

  const selectedLoan = useMemo(() => {
    if (selectedLoanId === null) return null;
    return scannedLoans.find((loan) => loan.id === selectedLoanId) ?? null;
  }, [scannedLoans, selectedLoanId]);

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
        tone: "border-amber-500/40 bg-amber-900/40 text-amber-200",
      });
    });
    upcomingLender.forEach((loan) => {
      items.push({
        id: `lender-upcoming-${loan.id}`,
        message: `Lender heads-up: Loan #${loan.id} ends in ${
          loan.endBlock - currentBlock
        } blocks.`,
        tone: "border-sky-500/40 bg-sky-900/40 text-sky-200",
      });
    });
    overdueBorrower.forEach((loan) => {
      items.push({
        id: `borrower-overdue-${loan.id}`,
        message: `Borrower alert: Loan #${loan.id} is past due.`,
        tone: "border-rose-500/40 bg-rose-900/40 text-rose-200",
      });
    });
    overdueLender.forEach((loan) => {
      items.push({
        id: `lender-overdue-${loan.id}`,
        message: `Lender alert: Loan #${loan.id} is past due.`,
        tone: "border-rose-500/40 bg-rose-900/40 text-rose-200",
      });
    });

    return items;
  }, [address, currentBlock, reminderWindow, scannedLoans]);

  const pushReminder = (message: string) => {
    setLogs((current) => logLine(`Reminder queued: ${message}`, current));
  };

  const handleConnect = () => {
    connect(expectedChainId);
  };

  const handleCreate = async () => {
    if (isCooldownActive) {
      setLogs((current) => logLine("Slow down: action cooldown active.", current));
      pushToast("Cooldown", "Please wait before submitting another transaction.", "info");
      return;
    }
    if (!config.address) {
      setLogs((current) =>
        logLine("Enter contract address before creating a loan.", current)
      );
      pushToast("Missing config", "Add the contract address before creating a loan.", "error");
      return;
    }
    if (createErrors.length) {
      setLogs((current) => logLine("Fix create form validation errors.", current));
      pushToast("Validation error", "Fix the create loan form inputs.", "error");
      return;
    }
    try {
      pushToast("Submitting", "Review and approve create-loan in your wallet.", "info");
      await callCreate(config, createForm);
      setLastActionAt(Date.now());
      setLogs((current) => logLine("Create-loan submitted.", current));
      pushToast("Submitted", "Create-loan transaction submitted.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setLogs((current) => logLine(`Create-loan failed: ${message}`, current));
      pushToast("Submission failed", message, "error");
    }
  };

  const applyPresets = (principal = createForm.principalAmount, duration = createForm.duration) => {
    setCreateForm((current) => ({
      ...current,
      repayAmount: calcRepayFromApr(principal, aprPreset, duration),
      collateralAmount: calcCollateralFromRatio(principal, collateralPreset),
    }));
  };

  const handleAddToken = () => {
    const symbol = tokenDraft.symbol.trim();
    const name = tokenDraft.name.trim();
    const contract = tokenDraft.contract.trim();
    if (!symbol || !contract) {
      setLogs((current) => logLine("Token requires a symbol and contract.", current));
      return;
    }
    const id = symbol.toLowerCase();
    const entry: TokenMeta = {
      id,
      symbol,
      name: name || symbol,
      contract,
      decimals: Number(tokenDraft.decimals) || 8,
    };
    setTokens((current) => {
      const without = current.filter((token) => token.id !== id);
      return [...without, entry];
    });
    setTokenDraft({ symbol: "", name: "", contract: "", decimals: 8 });
    if (!defaultTokenId) {
      setDefaultTokenId(id);
    }
    setSelectedPrincipalTokenId(id);
    setSelectedCollateralTokenId(id);
  };

  const handleRemoveToken = (tokenId: string) => {
    setTokens((current) => {
      const nextTokens = current.filter((token) => token.id !== tokenId);
      const fallback = nextTokens[0]?.id ?? "";
      setDefaultTokenId((currentDefault) =>
        currentDefault === tokenId ? fallback : currentDefault
      );
      setSelectedPrincipalTokenId((currentSelected) =>
        currentSelected === tokenId ? fallback : currentSelected
      );
      setSelectedCollateralTokenId((currentSelected) =>
        currentSelected === tokenId ? fallback : currentSelected
      );
      return nextTokens;
    });
  };

  const handleAddIndexedLoan = () => {
    const value = Number(indexerInput);
    if (!value || value <= 0) {
      setLogs((current) => logLine("Enter a valid loan ID.", current));
      return;
    }
    setIndexedLoanIds((current) => {
      const next = Array.from(new Set([...current, value])).sort((a, b) => a - b);
      return next;
    });
    setIndexerInput("");
  };

  const handleImportIndexedLoans = () => {
    if (!indexerImport.trim()) return;
    const ids = indexerImport
      .split(/[\s,]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!ids.length) {
      setLogs((current) => logLine("No valid IDs found in import.", current));
      return;
    }
    setIndexedLoanIds((current) => {
      const next = Array.from(new Set([...current, ...ids])).sort((a, b) => a - b);
      return next;
    });
    setIndexerImport("");
  };

  const fetchLoansByIds = async (ids: number[], label: string) => {
    if (!canRead) {
      setLogs((current) =>
        logLine("Provide API URL, contract, and read-only sender.", current)
      );
      pushToast("Missing config", "Set API URL, contract, and read-only sender.", "error");
      return;
    }

    if (!ids.length) {
      setLogs((current) => logLine("No loan IDs to fetch.", current));
      pushToast("Nothing to fetch", "Add loan IDs or scan a range first.", "info");
      return;
    }

    const cards: LoanSnapshot[] = [];
    const sources: Record<number, Loan> = {};
    for (const id of ids) {
      try {
        const result = await callReadOnly(config, "get-loan", [uintCV(id)]);
        if (result && typeof result === "object" && "value" in result) {
          const loan = (result as { value: Loan }).value;
          cards.push(formatLoan(id, loan, defaultToken?.symbol ?? "SIP-010"));
          sources[id] = loan;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setLogs((current) => logLine(`Read-only failed (ID ${id}): ${message}`, current));
        pushToast("Read-only error", `Loan ${id}: ${message}`, "error");
      }
    }
    setScannedLoans(cards);
    setLoanSources(sources);
    setLogs((current) => logLine(label, current));
    pushToast("Loans refreshed", `${cards.length} loans loaded.`, "success");
    setPage(1);
    setSelectedLoanId((current) => {
      if (current === null) {
        const next = cards[0]?.id ?? null;
        if (next !== null) setManageLoanId(next);
        return next;
      }
      const next = cards.some((loan) => loan.id === current) ? current : cards[0]?.id ?? null;
      if (next !== null) setManageLoanId(next);
      return next;
    });
  };

  const handleAction = async (action: string) => {
    if (isCooldownActive) {
      setLogs((current) => logLine("Slow down: action cooldown active.", current));
      pushToast("Cooldown", "Please wait before submitting another transaction.", "info");
      return;
    }
    if (!config.address) {
      setLogs((current) =>
        logLine("Enter contract address before submitting a transaction.", current)
      );
      pushToast("Missing config", "Add the contract address before submitting.", "error");
      return;
    }
    if (manageErrors.length) {
      setLogs((current) => logLine("Fix manage loan validation errors.", current));
      pushToast("Validation error", "Fix the manage loan inputs.", "error");
      return;
    }
    try {
      pushToast("Submitting", `Review and approve ${action}.`, "info");
      await callContract(config, action, loanIdArg(manageLoanId));
      setLastActionAt(Date.now());
      setLogs((current) => logLine(`${action} submitted.`, current));
      pushToast("Submitted", `${action} transaction submitted.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setLogs((current) => logLine(`${action} failed: ${message}`, current));
      pushToast("Submission failed", message, "error");
    }
  };

  const handleScan = async () => {
    if (scanErrors.length) {
      setLogs((current) => logLine("Fix scan validation errors.", current));
      pushToast("Validation error", "Fix scan range before searching.", "error");
      return;
    }
    const ids: number[] = [];
    for (let id = scanRange.start; id <= scanRange.end; id += 1) {
      ids.push(id);
    }
    await fetchLoansByIds(
      ids,
      `Scanned loans ${scanRange.start} → ${scanRange.end}.`
    );
    if (indexerAddScan && ids.length) {
      setIndexedLoanIds((current) => {
        const next = Array.from(new Set([...current, ...ids])).sort((a, b) => a - b);
        return next;
      });
    }
  };

  const handleIndexRefresh = async () => {
    await fetchLoansByIds(indexedLoanIds, "Refreshed indexed loans.");
  };

  const handleDiagnosticsRead = async () => {
    if (!canRead) {
      pushToast("Missing config", "Set API URL, contract, and read-only sender.", "error");
      return;
    }
    try {
      const result = await callReadOnly(config, "get-loan", [uintCV(diagLoanId)]);
      setDiagResult(JSON.stringify(result, null, 2));
      pushToast("Diagnostics", `Read-only loan ${diagLoanId} loaded.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setDiagResult(`Error: ${message}`);
      pushToast("Diagnostics error", message, "error");
    }
  };

  const handleExportLoans = () => {
    if (!filteredLoans.length) {
      pushToast("Export", "No loans to export.", "info");
      return;
    }
    const rows: CsvRow[] = filteredLoans.map((loan) => {
      const source = loanSources[loan.id];
      return {
        id: loan.id,
        status: STATUS_LABELS[loan.status.toString()] ?? "Unknown",
        borrower: loan.borrower,
        lender: loan.lender ?? "",
        principal: loan.principal,
        collateral: loan.collateral,
        repay: loan.repay,
        duration: loan.duration,
        endBlock: loan.endBlock,
        apr: source ? calculateApr(source).toFixed(2) : "",
      };
    });
    downloadCsv("loans-export.csv", rows);
    pushToast("Export", "Loan list CSV downloaded.", "success");
  };

  const handleExportRepaymentHistory = () => {
    if (!selectedLoan) {
      pushToast("Export", "Select a loan to export history.", "info");
      return;
    }
    const status = selectedLoan.status;
    const rows: CsvRow[] = [
      {
        loanId: selectedLoan.id,
        event: "Created",
        status: STATUS_LABELS[STATUS.OPEN.toString()],
        note: "Loan created",
      },
    ];
    if (status >= STATUS.FUNDED) {
      rows.push({
        loanId: selectedLoan.id,
        event: "Funded",
        status: STATUS_LABELS[STATUS.FUNDED.toString()],
        note: "Principal released",
      });
    }
    if (status === STATUS.REPAID) {
      rows.push({
        loanId: selectedLoan.id,
        event: "Repaid",
        status: STATUS_LABELS[STATUS.REPAID.toString()],
        note: "Loan repaid",
      });
    }
    if (status === STATUS.DEFAULTED) {
      rows.push({
        loanId: selectedLoan.id,
        event: "Defaulted",
        status: STATUS_LABELS[STATUS.DEFAULTED.toString()],
        note: "Collateral claimed",
      });
    }
    if (status === STATUS.CANCELLED) {
      rows.push({
        loanId: selectedLoan.id,
        event: "Cancelled",
        status: STATUS_LABELS[STATUS.CANCELLED.toString()],
        note: "Loan cancelled",
      });
    }
    downloadCsv(`loan-${selectedLoan.id}-history.csv`, rows);
    pushToast("Export", "Repayment history CSV downloaded.", "success");
  };

  return (
    <div className="page">
      <div className="glow" />
      <div className="fixed right-6 top-6 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((toast) => (
          <Card
            key={toast.id}
            className={`border ${
              toast.tone === "success"
                ? "border-emerald-500/40 bg-emerald-900/40 text-emerald-200"
                : toast.tone === "error"
                ? "border-rose-500/40 bg-rose-900/40 text-rose-200"
                : "border-sky-500/40 bg-sky-900/40 text-sky-200"
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{toast.title}</CardTitle>
              <CardDescription className="text-xs">{toast.message}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <header className="site-header">
        <div className="topbar">
          <div className="topbar-brand">
            <p className="eyebrow">P2P Lending on Stacks</p>
            <h1>Stacks Lend</h1>
          </div>
          <nav className="nav-links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/loans" className={({ isActive }) => (isActive ? "active" : "")}>
              Loans
            </NavLink>
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              Admin
            </NavLink>
          </nav>
          <div className="topbar-actions">
            <button className="primary" onClick={handleConnect} disabled={isConnecting}>
              {isConnected
                ? `Connected: ${address}`
                : isConnecting
                ? "Connecting..."
                : "Connect Wallet"}
            </button>
            {chainId ? <p className="hint">WalletConnect chain: {chainId}</p> : null}
            {hasChainMismatch ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-900/30 p-3 text-sm text-amber-200">
                <p className="mb-2 font-semibold">Network mismatch</p>
                <p className="mb-2 text-xs">
                  Connected to {chainId}, but this app expects {expectedChainId}.
                </p>
                <button className="ghost" onClick={handleConnect} disabled={isConnecting}>
                  Switch to {expectedChainId}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="container">

        {isDashboard ? (
          <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Fixed-term loans using escrow. Pair STX with sBTC for clean, predictable deals.</p>
              <h2 className="mb-2">Borrower + Lender Overview</h2>
              <p className="subtitle small">
                Track active positions, repayment pressure, and defaults from the
                latest scan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-slate-700 bg-slate-900">
                Scanned loans {scannedLoans.length}
              </Badge>
              <Badge className="border-slate-700 bg-slate-900">
                Current block {currentBlock || "Not set"}
              </Badge>
              <Badge className="border-slate-700 bg-slate-900">
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
        ) : null}

        {isDashboard ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Borrower Reputation</CardTitle>
              <CardDescription>
                Snapshot of on-chain repayment history for the connected borrower.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <p className="text-sm text-slate-400">Total loans</p>
                  <p className="text-2xl font-semibold">{borrowerReputation.total}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Repaid</p>
                  <p className="text-2xl font-semibold">{borrowerReputation.repaid}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Defaulted</p>
                  <p className="text-2xl font-semibold">{borrowerReputation.defaulted}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Active</p>
                  <p className="text-2xl font-semibold">{borrowerReputation.active}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge className="border-emerald-500/40 bg-emerald-900/40 text-emerald-200">
                  Repayment rate {borrowerReputation.repaymentRate}%
                </Badge>
                <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                  {address ? "Wallet-linked" : "Connect wallet for borrower filtering"}
                </Badge>
                <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                  Based on scanned loans
                </Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reputation Notes</CardTitle>
              <CardDescription>Quick context for lenders.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Settled loans</span>
                  <span className="font-semibold">
                    {borrowerReputation.repaid + borrowerReputation.defaulted}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Open exposure</span>
                  <span className="font-semibold">{borrowerReputation.active}</span>
                </div>
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                  Hook up event indexing for timestamps and richer risk signals.
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isDashboard ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Lender Risk Indicators</CardTitle>
              <CardDescription>
                Collateral ratio insights, volatility notes, and repayment history.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <p className="text-sm text-slate-400">Total loans</p>
                  <p className="text-2xl font-semibold">{lenderRisk.total}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Defaults</p>
                  <p className="text-2xl font-semibold">{lenderRisk.defaulted}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Default rate</p>
                  <p className="text-2xl font-semibold">{lenderRisk.defaultRate}%</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Avg collateral ratio</p>
                  <p className="text-2xl font-semibold">
                    {lenderRisk.avgCollateralRatio
                      ? lenderRisk.avgCollateralRatio.toFixed(2) + "x"
                      : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                  Volatility note: assumes stable pricing
                </Badge>
                <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                  {address ? "Wallet-linked" : "Connect wallet for lender filtering"}
                </Badge>
              </div>
              <div className="mt-4 space-y-2">
                {lenderLoans.length ? (
                  lenderLoans.slice(0, 3).map((loan) => {
                    const source = loanSources[loan.id];
                    const ratio = source
                      ? Number(source.collateral_amount) / Number(source.principal_amount || 1)
                      : 0;
                    return (
                      <div
                        key={loan.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-sm"
                      >
                        <div>
                          <span className="font-semibold">Loan #{loan.id}</span>
                          <div className="text-xs text-slate-400">
                            {STATUS_LABELS[loan.status.toString()] ?? "Unknown"}
                          </div>
                        </div>
                        <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                          Collateral ratio {ratio ? ratio.toFixed(2) + "x" : "—"}
                        </Badge>
                        <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                          {riskLabel(ratio)}
                        </Badge>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">
                    No lender loans available for risk analysis yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Risk Notes</CardTitle>
              <CardDescription>Signal strength depends on indexed history.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Repaid loans</span>
                  <span className="font-semibold">{lenderRisk.repaid}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Settled loans</span>
                  <span className="font-semibold">
                    {lenderRisk.repaid + lenderRisk.defaulted}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                  Add oracle pricing to improve collateral volatility scoring.
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isAdmin && import.meta.env.DEV ? (
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Diagnostics Panel</CardTitle>
                <CardDescription>
                  Developer-only tools for contract calls and event debugging.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm text-slate-400">
                    Enable diagnostics
                    <select
                      value={showDiagnostics ? "on" : "off"}
                      onChange={(event) => setShowDiagnostics(event.target.value === "on")}
                    >
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                  <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                    API {config.apiUrl || "Not set"}
                  </Badge>
                  <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                    Contract {config.address || "Not set"}
                  </Badge>
                </div>
                {showDiagnostics ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <label>
                        Read-only: get-loan ID
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={1}
                            value={diagLoanId}
                            onChange={(event) => setDiagLoanId(Number(event.target.value))}
                          />
                          <button className="ghost" type="button" onClick={handleDiagnosticsRead}>
                            Run
                          </button>
                        </div>
                      </label>
                      <div className="space-y-2 text-sm text-slate-400">
                        <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                          Read-only sender: {config.readOnlySender || "Not set"}
                        </div>
                        <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                          Contract name: {config.name}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-400">Last result</p>
                      <pre className="log">{diagResult || "No diagnostics run yet."}</pre>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-400">
                    Diagnostics are disabled. Toggle on to run read-only calls.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Diagnostics Notes</CardTitle>
                <CardDescription>Useful for dev-only testing.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                    Track errors via the activity log and toast stack.
                  </div>
                  <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                    Extend with event indexing once a backend indexer is live.
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Admin</CardTitle>
              <CardDescription>Diagnostics are available in dev mode.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {isDashboard ? (
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
                <Badge className="border-slate-700 bg-slate-900">
                  Current block {currentBlock || "Not set"}
                </Badge>
                <Badge className="border-slate-700 bg-slate-900">
                  {address ? "Filtered to wallet" : "Connect wallet for targeting"}
                </Badge>
              </div>
              <div className="mt-4 space-y-2">
                {reminders.length ? (
                  reminders.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-sm"
                    >
                      <Badge className={item.tone}>{item.message}</Badge>
                      <button
                        className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-200 shadow-sm transition hover:bg-slate-800"
                        onClick={() => pushReminder(item.message)}
                      >
                        Add to activity log
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">
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
                  <span className="text-slate-400">Upcoming</span>
                  <span className="font-semibold">
                    {reminders.filter((item) => item.id.includes("upcoming")).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Overdue</span>
                  <span className="font-semibold">
                    {reminders.filter((item) => item.id.includes("overdue")).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Total reminders</span>
                  <span className="font-semibold">{reminders.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isLoans ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>SIP-010 Token Registry</CardTitle>
              <CardDescription>
                Manage supported tokens for loan creation and display labels.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tokens.length ? (
                  tokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{token.symbol}</span>
                          <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                            {token.name}
                          </Badge>
                          {token.id === defaultTokenId ? (
                            <Badge className="border-emerald-500/40 bg-emerald-900/40 text-emerald-200">
                              Default
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-400">
                          {token.contract}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="ghost"
                          onClick={() => setDefaultTokenId(token.id)}
                          disabled={token.id === defaultTokenId}
                        >
                          Set default
                        </button>
                        <button
                          className="ghost"
                          onClick={() => handleRemoveToken(token.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">
                    No tokens configured yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Add Token</CardTitle>
              <CardDescription>Register another SIP-010 asset.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <label>
                  Symbol
                  <input
                    value={tokenDraft.symbol}
                    onChange={(event) =>
                      setTokenDraft((current) => ({
                        ...current,
                        symbol: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Name
                  <input
                    value={tokenDraft.name}
                    onChange={(event) =>
                      setTokenDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Contract
                  <input
                    placeholder="SP...token-name"
                    value={tokenDraft.contract}
                    onChange={(event) =>
                      setTokenDraft((current) => ({
                        ...current,
                        contract: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Decimals
                  <input
                    type="number"
                    min={0}
                    value={tokenDraft.decimals}
                    onChange={(event) =>
                      setTokenDraft((current) => ({
                        ...current,
                        decimals: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <button className="primary" onClick={handleAddToken}>
                  Add token
                </button>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isLoans ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Loan Indexer</CardTitle>
              <CardDescription>
                Keep a local index of loan IDs and refresh them without range scans.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="border-slate-700 bg-slate-900">
                  Indexed loans {indexedLoanIds.length}
                </Badge>
                <button className="primary" onClick={handleIndexRefresh}>
                  Refresh indexed loans
                </button>
                <button
                  className="ghost"
                  onClick={() => setIndexedLoanIds([])}
                  disabled={!indexedLoanIds.length}
                >
                  Clear index
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {indexedLoanIds.length ? (
                  <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                    {indexedLoanIds.map((id) => (
                      <Badge key={id} className="border-slate-700 bg-slate-800 text-slate-300">
                        #{id}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    Add loan IDs to build the index, or scan a range and save them.
                  </p>
                )}
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <label>
                  Add loan ID
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={indexerInput}
                      onChange={(event) => setIndexerInput(event.target.value)}
                    />
                    <button className="ghost" type="button" onClick={handleAddIndexedLoan}>
                      Add
                    </button>
                  </div>
                </label>
                <label>
                  Import IDs (comma or space separated)
                  <div className="flex gap-2">
                    <input
                      value={indexerImport}
                      onChange={(event) => setIndexerImport(event.target.value)}
                      placeholder="1, 2, 3"
                    />
                    <button className="ghost" type="button" onClick={handleImportIndexedLoans}>
                      Import
                    </button>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Indexer Options</CardTitle>
              <CardDescription>Control how scans update the index.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <label>
                  Add scanned IDs to indexer
                  <select
                    value={indexerAddScan ? "yes" : "no"}
                    onChange={(event) => setIndexerAddScan(event.target.value === "yes")}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label>
                  Indexed loans
                  <p className="text-sm text-slate-400">
                    {indexedLoanIds.length
                      ? `Next refresh will fetch ${indexedLoanIds.length} IDs.`
                      : "No indexed loans yet."}
                  </p>
                </label>
              </div>
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isLoans ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Repayment Schedule Calculator</CardTitle>
              <CardDescription>
                Estimate total cost, APR, and interim checkpoints for a loan term.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  Principal amount
                  <input
                    type="number"
                    min={0}
                    value={calcInput.principal}
                    onChange={(event) =>
                      setCalcInput((current) => ({
                        ...current,
                        principal: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Repay amount
                  <input
                    type="number"
                    min={0}
                    value={calcInput.repay}
                    onChange={(event) =>
                      setCalcInput((current) => ({
                        ...current,
                        repay: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Duration (blocks)
                  <input
                    type="number"
                    min={1}
                    value={calcInput.duration}
                    onChange={(event) =>
                      setCalcInput((current) => ({
                        ...current,
                        duration: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Blocks per year
                  <input
                    type="number"
                    min={1}
                    value={calcInput.blocksPerYear}
                    onChange={(event) =>
                      setCalcInput((current) => ({
                        ...current,
                        blocksPerYear: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              {repaymentSummary ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <Card>
                    <CardHeader>
                      <CardTitle>Total Cost</CardTitle>
                      <CardDescription>Principal + interest.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">
                        {repaymentSummary.totalDue}
                      </div>
                      <p className="text-xs text-slate-400">
                        Interest: {repaymentSummary.interest}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>APR Estimate</CardTitle>
                      <CardDescription>Based on duration + blocks/year.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">
                        {repaymentSummary.apr.toFixed(2)}%
                      </div>
                      <p className="text-xs text-slate-400">
                        Per-block interest: {repaymentSummary.perBlock.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Duration</CardTitle>
                      <CardDescription>Block-based term length.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">
                        {calcInput.duration} blocks
                      </div>
                      <p className="text-xs text-slate-400">
                        Blocks/year: {calcInput.blocksPerYear}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-400">
                  Enter principal, repay, and duration to see a breakdown.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Checkpoint Schedule</CardTitle>
              <CardDescription>Accrued totals at common milestones.</CardDescription>
            </CardHeader>
            <CardContent>
              {repaymentSummary ? (
                <div className="space-y-3 text-sm">
                  {repaymentSummary.checkpoints.map((point) => (
                    <div
                      key={point.label}
                      className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2"
                    >
                      <span>{point.label} • block {point.block}</span>
                      <span className="font-semibold">{point.totalDue}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  Schedule appears once inputs are valid.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
        ) : null}

        {isLoans ? (
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
                    setCreateForm((current) => {
                      const duration = Number(event.target.value);
                      if (!autoApplyPresets) {
                        return { ...current, duration };
                      }
                      return {
                        ...current,
                        duration,
                        repayAmount: calcRepayFromApr(
                          current.principalAmount,
                          aprPreset,
                          duration
                        ),
                      };
                    })
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
                    setCreateForm((current) => {
                      const principalAmount = Number(event.target.value);
                      if (!autoApplyPresets) {
                        return { ...current, principalAmount };
                      }
                      return {
                        ...current,
                        principalAmount,
                        repayAmount: calcRepayFromApr(
                          principalAmount,
                          aprPreset,
                          current.duration
                        ),
                        collateralAmount: calcCollateralFromRatio(
                          principalAmount,
                          collateralPreset
                        ),
                      };
                    })
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
            <div className="panel-grid">
              <label>
                Principal token
                <select
                  value={createForm.principalIsStx ? "stx" : selectedPrincipalTokenId}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "stx") {
                      setCreateForm((current) => ({ ...current, principalIsStx: true }));
                      return;
                    }
                    setSelectedPrincipalTokenId(next);
                    setCreateForm((current) => ({ ...current, principalIsStx: false }));
                  }}
                >
                  <option value="stx">STX</option>
                  {tokens.map((token) => (
                    <option key={token.id} value={token.id}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Collateral token
                <select
                  value={createForm.collateralIsStx ? "stx" : selectedCollateralTokenId}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "stx") {
                      setCreateForm((current) => ({ ...current, collateralIsStx: true }));
                      return;
                    }
                    setSelectedCollateralTokenId(next);
                    setCreateForm((current) => ({ ...current, collateralIsStx: false }));
                  }}
                >
                  <option value="stx">STX</option>
                  {tokens.map((token) => (
                    <option key={token.id} value={token.id}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="panel-grid">
              <label>
                APR preset
                <select
                  value={aprPreset}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setAprPreset(next);
                    if (autoApplyPresets) {
                      setCreateForm((current) => ({
                        ...current,
                        repayAmount: calcRepayFromApr(
                          current.principalAmount,
                          next,
                          current.duration
                        ),
                      }));
                    }
                  }}
                >
                  {APR_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Collateral ratio preset
                <select
                  value={collateralPreset}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setCollateralPreset(next);
                    if (autoApplyPresets) {
                      setCreateForm((current) => ({
                        ...current,
                        collateralAmount: calcCollateralFromRatio(
                          current.principalAmount,
                          next
                        ),
                      }));
                    }
                  }}
                >
                  {COLLATERAL_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Auto-apply presets
                <select
                  value={autoApplyPresets ? "on" : "off"}
                  onChange={(event) => setAutoApplyPresets(event.target.value === "on")}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label>
                Apply presets
                <button
                  className="ghost"
                  type="button"
                  onClick={() => applyPresets()}
                >
                  Apply to amounts
                </button>
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
                  {selectedPrincipalToken?.symbol ?? "Token"}
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
                  {selectedCollateralToken?.symbol ?? "Token"}
                </label>
              </div>
            </div>
            <div className="panel-grid">
              <label>
                Action cooldown (ms)
                <input
                  type="number"
                  min={500}
                  value={cooldownMs}
                  onChange={(event) => setCooldownMs(Number(event.target.value))}
                />
              </label>
              <label>
                Current status
                <p className="hint">
                  {isCooldownActive ? "Cooldown active" : "Ready"}
                </p>
              </label>
            </div>
            <button
              className="primary"
              onClick={handleCreate}
              disabled={Boolean(createErrors.length) || isCooldownActive}
            >
              Create loan
            </button>
            {createErrors.length ? (
              <div className="space-y-1 text-sm text-rose-600">
                {createErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
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
              <button
                onClick={() => handleAction("fund-loan")}
                disabled={Boolean(manageErrors.length) || isCooldownActive}
              >
                Fund loan
              </button>
              <button
                onClick={() => handleAction("repay")}
                disabled={Boolean(manageErrors.length) || isCooldownActive}
              >
                Repay
              </button>
              <button
                onClick={() => handleAction("claim-default")}
                disabled={Boolean(manageErrors.length) || isCooldownActive}
              >
                Claim default
              </button>
              <button
                className="ghost"
                onClick={() => handleAction("cancel-loan")}
                disabled={Boolean(manageErrors.length) || isCooldownActive}
              >
                Cancel
              </button>
            </div>
            {manageErrors.length ? (
              <div className="space-y-1 text-sm text-rose-600">
                {manageErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
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
                <button
                  className="primary"
                  onClick={handleScan}
                  disabled={Boolean(scanErrors.length)}
                >
                  Scan
                </button>
              </div>
            </div>
            {scanErrors.length ? (
              <div className="space-y-1 text-sm text-rose-600">
                {scanErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="hint">
                Use the Loan Indexer to refresh known IDs without scanning ranges.
              </p>
              <button className="ghost" onClick={handleIndexRefresh}>
                Refresh indexed loans
              </button>
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
                  <option value="principal-token">Principal: Token</option>
                  <option value="collateral-stx">Collateral: STX</option>
                  <option value="collateral-token">Collateral: Token</option>
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
                  <div
                    className="loan-card cursor-pointer transition hover:-translate-y-0.5 hover:shadow-lg"
                    key={loan.id}
                    onClick={() => {
                      setSelectedLoanId(loan.id);
                      setManageLoanId(loan.id);
                    }}
                  >
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
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Loan Detail View</CardTitle>
                  <CardDescription>
                    Select a loan to review the full lifecycle, actions, and history.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedLoan ? (
                    <div className="grid gap-6 lg:grid-cols-3">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold">
                            Loan #{selectedLoan.id}
                          </span>
                          <Badge className={statusBadgeClass(selectedLoan.status)}>
                            {STATUS_LABELS[selectedLoan.status.toString()] ?? "Unknown"}
                          </Badge>
                        </div>
                        <div className="text-sm text-slate-400">
                          Borrower {formatAddress(selectedLoan.borrower)}
                          <br />
                          Lender {formatAddress(selectedLoan.lender)}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                            Principal {selectedLoan.principal}
                          </Badge>
                          <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                            Collateral {selectedLoan.collateral}
                          </Badge>
                          <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                            Repay {selectedLoan.repay}
                          </Badge>
                          <Badge className="border-slate-700 bg-slate-800 text-slate-300">
                            End block {selectedLoan.endBlock}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                          Lifecycle Actions
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleAction("fund-loan")}
                            disabled={Boolean(manageErrors.length) || isCooldownActive}
                          >
                            Fund loan
                          </button>
                          <button
                            onClick={() => handleAction("repay")}
                            disabled={Boolean(manageErrors.length) || isCooldownActive}
                          >
                            Repay
                          </button>
                          <button
                            onClick={() => handleAction("claim-default")}
                            disabled={Boolean(manageErrors.length) || isCooldownActive}
                          >
                            Claim default
                          </button>
                          <button
                            className="ghost"
                            onClick={() => handleAction("cancel-loan")}
                            disabled={Boolean(manageErrors.length) || isCooldownActive}
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="text-xs text-slate-400">
                          Actions run against the selected loan ID.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                          Transaction History
                        </h3>
                    <div className="space-y-2 text-sm text-slate-300">
                      <div className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                        <span>Created</span>
                        <span className="text-slate-400">On-chain</span>
                      </div>
                          <div className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                            <span>Funded</span>
                            <span className="text-slate-400">
                              {selectedLoan.status >= STATUS.FUNDED ? "Confirmed" : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                            <span>Repayment</span>
                            <span className="text-slate-400">
                              {selectedLoan.status >= STATUS.REPAID ? "Settled" : "Awaiting"}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400">
                          Hook up an indexer later for detailed timestamps.
                        </p>
                        <button className="ghost" onClick={handleExportRepaymentHistory}>
                          Export repayment history CSV
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Scan loans to populate the detail view.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                Showing {pagedLoans.length} of {filteredLoans.length}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="ghost" onClick={handleExportLoans}>
                  Export loan list CSV
                </button>
                <label className="text-sm text-slate-400">
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
                <span className="text-sm text-slate-400">
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
        ) : null}

        <section className="panel log-panel">
          <h2>Activity Log</h2>
          <pre className="log">{logs.join("\n")}</pre>
        </section>
      </main>
    </div>
  );
}
