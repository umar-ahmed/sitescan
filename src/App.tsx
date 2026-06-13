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
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
              className="text-sm text-muted-foreground hover:underline"
            >
              Testnet faucet
            </a>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-4">
          {currentAccount ? (
            <>
              <PostJob />
              <div>
                <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">
                  Your jobs &amp; incoming scans
                </h2>
                <JobBoard />
              </div>
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Connect Wallet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Connect a Sui testnet wallet to post scan bounties. Scanner
                  nodes pick them up, capture the page, and upload evidence to
                  Walrus — the screenshots appear here as they arrive.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
