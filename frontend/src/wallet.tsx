import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import UniversalProvider from "@walletconnect/universal-provider";

type WalletContextValue = {
  address: string;
  chainId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: (chainId: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const projectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
  import.meta.env.VITE_REOWN_PROJECT_ID ??
  "";

const walletMetadata = {
  name: "Stacks Lend",
  description: "Peer-to-peer lending on Stacks",
  url: "https://localhost",
  icons: ["https://stacks.co/favicon.ico"],
};

const parseAccountAddress = (account: string) => {
  const parts = account.split(":");
  return parts[2] ?? account;
};

const parseAccountChain = (account: string) => {
  const parts = account.split(":");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<UniversalProvider | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const initProvider = useCallback(async () => {
    if (provider) return provider;
    const instance = await UniversalProvider.init({
      projectId,
      metadata: walletMetadata,
    });
    setProvider(instance);
    return instance;
  }, [provider]);

  const updateFromAccounts = useCallback((accounts?: string[]) => {
    if (!accounts?.length) {
      setAddress("");
      setChainId(null);
      return;
    }
    const account = accounts[0];
    setAddress(parseAccountAddress(account));
    setChainId(parseAccountChain(account));
  }, []);

  useEffect(() => {
    if (!provider) return;

    const handleAccounts = (accounts: string[]) => updateFromAccounts(accounts);
    const handleSessionDelete = () => updateFromAccounts([]);

    provider.on("accountsChanged", handleAccounts);
    provider.on("session_delete", handleSessionDelete);

    const sessionAccounts = provider.session?.namespaces?.stacks?.accounts;
    if (sessionAccounts?.length) {
      updateFromAccounts(sessionAccounts);
    }

    return () => {
      provider.removeListener("accountsChanged", handleAccounts);
      provider.removeListener("session_delete", handleSessionDelete);
    };
  }, [provider, updateFromAccounts]);

  const connect = useCallback(
    async (targetChainId: string) => {
      setIsConnecting(true);
      try {
        const instance = await initProvider();
        await instance.connect({
          namespaces: {
            stacks: {
              methods: [
                "stx_getAccounts",
                "stx_signMessage",
                "stx_signTransaction",
                "stx_sendTransaction",
              ],
              chains: [targetChainId],
              events: ["accountsChanged", "chainChanged"],
            },
          },
        });
        const accounts = instance.session?.namespaces?.stacks?.accounts;
        updateFromAccounts(accounts);
      } finally {
        setIsConnecting(false);
      }
    },
    [initProvider, updateFromAccounts]
  );

  const disconnect = useCallback(async () => {
    if (!provider) return;
    await provider.disconnect();
    updateFromAccounts([]);
  }, [provider, updateFromAccounts]);

  const value = useMemo(
    () => ({
      address,
      chainId,
      isConnected: Boolean(address),
      isConnecting,
      connect,
      disconnect,
    }),
    [address, chainId, connect, disconnect, isConnecting]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }
  return context;
}
