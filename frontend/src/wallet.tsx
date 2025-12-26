import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createAppKit } from "@reown/appkit/react";

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
  url: "https://localhost:5173",
  icons: ["https://stacks.co/favicon.ico"],
};

const stacksTestnet = {
  id: "testnet",
  name: "Stacks Testnet",
  chainNamespace: "stacks",
  caipNetworkId: "stacks:testnet",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://api.testnet.hiro.so"] },
  },
  blockExplorers: {
    default: { name: "Hiro", url: "https://explorer.hiro.so" },
  },
  testnet: true,
};

const stacksMainnet = {
  id: "mainnet",
  name: "Stacks Mainnet",
  chainNamespace: "stacks",
  caipNetworkId: "stacks:mainnet",
  nativeCurrency: { name: "Stacks", symbol: "STX", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://api.mainnet.hiro.so"] },
  },
  blockExplorers: {
    default: { name: "Hiro", url: "https://explorer.hiro.so" },
  },
};

const appKit = createAppKit({
  projectId,
  metadata: walletMetadata,
  networks: [stacksTestnet, stacksMainnet],
  defaultNetwork: stacksTestnet,
  universalProviderConfigOverride: {
    methods: {
      stacks: [
        "stx_getAddresses",
        "stx_transferStx",
        "stx_signMessage",
        "stx_signTransaction",
        "stx_signStructuredMessage",
        "stx_callContract",
      ],
    },
    chains: {
      stacks: ["stacks:testnet", "stacks:mainnet"],
    },
    events: {
      stacks: ["accountsChanged", "chainChanged"],
    },
    defaultChain: "stacks:testnet",
  },
});

const parseCaipAddress = (caipAddress: string) => {
  const parts = caipAddress.split(":");
  return {
    chainId: parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null,
    address: parts[2] ?? "",
  };
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const syncFromAppKit = useCallback(() => {
    const caipAddress = appKit.getCaipAddress("stacks");
    if (!caipAddress) {
      setAddress("");
      setChainId(null);
      return;
    }
    const parsed = parseCaipAddress(caipAddress);
    setAddress(parsed.address);
    setChainId(parsed.chainId);
  }, []);

  useEffect(() => {
    syncFromAppKit();
    const unsubscribe = appKit.subscribeState(() => {
      syncFromAppKit();
    });
    return () => {
      unsubscribe?.();
    };
  }, [syncFromAppKit]);

  const connect = useCallback(
    async (targetChainId: string) => {
      setIsConnecting(true);
      try {
        const nextNetwork =
          targetChainId === "stacks:mainnet" ? stacksMainnet : stacksTestnet;
        await appKit.switchNetwork(nextNetwork);
        await appKit.open({ view: "Connect", namespace: "stacks" });
        syncFromAppKit();
      } finally {
        setIsConnecting(false);
      }
    },
    [syncFromAppKit]
  );

  const disconnect = useCallback(async () => {
    await appKit.disconnect("stacks");
    setAddress("");
    setChainId(null);
  }, []);

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
