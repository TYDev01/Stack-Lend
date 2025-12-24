import { useMemo, useState } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { openContractCall } from "@stacks/connect";
import { AppConfig, UserSession } from "@stacks/connect";
import { StacksMainnet, StacksTestnet } from "@stacks/network";
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

const formatLoan = (loanId: number, loan: Loan) => ({
  id: loanId,
  principal: `${loan.principal_is_stx ? "STX" : "sBTC"} ${loan.principal_amount}`,
  collateral: `${loan.collateral_is_stx ? "STX" : "sBTC"} ${loan.collateral_amount}`,
  repay: `${loan.repay_amount}`,
  duration: `${loan.end_block}`,
});

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
  const [openLoans, setOpenLoans] = useState<ReturnType<typeof formatLoan>[]>([]);

  const canRead = useMemo(
    () =>
      config.address &&
      config.name &&
      config.apiUrl &&
      config.readOnlySender,
    [config]
  );

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

    const cards: ReturnType<typeof formatLoan>[] = [];
    for (let id = scanRange.start; id <= scanRange.end; id += 1) {
      const result = await callReadOnly(config, "get-loan", [uintCV(id)]);
      if (result && typeof result === "object" && "value" in result) {
        const loan = (result as { value: Loan }).value;
        if (loan.status === STATUS.OPEN) {
          cards.push(formatLoan(id, loan));
        }
      }
    }
    setOpenLoans(cards);
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
            <button className="primary" onClick={handleConnect}>
              {isConnected ? `Connected: ${address}` : "Connect Wallet"}
            </button>
          </div>
        </header>

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
