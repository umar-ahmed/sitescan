import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { ScanExperience } from "./ScanExperience";
import { JobBoard } from "./JobBoard";
import { Radar, Lock } from "lucide-react";

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
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-xs text-violet-200">
            <div className="flex items-center gap-1.5 font-medium">
              <Lock className="h-4 w-4" /> TLSNotary validation layer
            </div>
            <p className="mt-1">
              Scanner nodes attach a{" "}
              <span className="font-medium">TLSNotary proof</span> that the
              target host actually served the HTML over TLS — the server
              can&apos;t be impersonated and the scanner can&apos;t fabricate
              evidence. The verifier independently re-checks each proof (notary
              signature → proven host → HTTP status → HTML hash) and{" "}
              <span className="font-medium">payout is gated on it</span>. Run{" "}
              <code className="text-violet-100">pnpm verify</code> in another
              window to release payouts.
            </p>
          </div>
          <JobBoard />
        </div>
      </main>
    </div>
  );
}

export default App;
