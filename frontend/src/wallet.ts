import { createAppKit } from "@reown/appkit/react";
import { StacksAdapter } from "@reown/appkit-adapter-stacks";

const projectId =
  import.meta.env.VITE_REOWN_PROJECT_ID ??
  "d806ccf37143d8296a9c2cd23a52577e";

const stacksTestnet = {
  id: "stacks:testnet",
  name: "Stacks Testnet",
  rpcUrl: "https://api.testnet.hiro.so",
  explorerUrl: "https://explorer.hiro.so",
  nativeCurrency: {
    name: "Stacks",
    symbol: "STX",
    decimals: 6,
  },
};

const stacksMainnet = {
  id: "stacks:mainnet",
  name: "Stacks Mainnet",
  rpcUrl: "https://api.mainnet.hiro.so",
  explorerUrl: "https://explorer.hiro.so",
  nativeCurrency: {
    name: "Stacks",
    symbol: "STX",
    decimals: 6,
  },
};

const stacksAdapter = new StacksAdapter({
  projectId,
  networks: [stacksTestnet, stacksMainnet],
});

createAppKit({
  adapters: [stacksAdapter],
  networks: [stacksTestnet, stacksMainnet],
  projectId,
  metadata: {
    name: "Stacks Lend",
    description: "Peer-to-peer lending on Stacks",
    url: "https://localhost",
    icons: ["https://stacks.co/favicon.ico"],
  },
});
