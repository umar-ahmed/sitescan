import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { PostJob } from "./PostJob";
import { JobBoard } from "./JobBoard";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Wallet, Radar } from "lucide-react";

function App() {
  const currentAccount = useCurrentAccount();

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

      {currentAccount ? (
        <>
          <div className="border-b bg-card">
            <div className="container mx-auto px-4">
              <PostJob />
            </div>
          </div>
          <main className="container mx-auto px-4 py-8">
            <div className="mx-auto max-w-3xl">
              <JobBoard />
            </div>
          </main>
        </>
      ) : (
        <main className="container mx-auto px-4 py-10">
          <div className="mx-auto max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Connect Wallet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Connect a Sui testnet wallet to scan a URL from real victim
                  vantages. Independent nodes capture the page and upload
                  evidence to Walrus — the screenshots appear here as they
                  arrive.
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
