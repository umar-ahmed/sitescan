import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { ScanExperience } from "./ScanExperience";
import { JobBoard } from "./JobBoard";
import { Radar } from "lucide-react";

function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-[var(--color-nav)] text-white">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Radar className="h-5 w-5" />
            Proof of Scan
          </h1>
          <div className="flex items-center gap-3">
            <a
              href="https://faucet.sui.io/?network=testnet"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-white/70 hover:text-white hover:underline"
            >
              Testnet faucet
            </a>
            <ConnectButton />
          </div>
        </div>
      </header>

      <ScanExperience />

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <JobBoard />
        </div>
      </main>
    </div>
  );
}

export default App;
