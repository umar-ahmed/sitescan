import { useState } from "react";
import { Info, ExternalLink, Copy, Check, X } from "lucide-react";
import { TESTNET_SCAN_MARKET_PACKAGE_ID, TESTNET_MARKET_ID } from "./constants";

const NETWORK = "testnet";
const EXPLORER = `https://suiscan.com/${NETWORK}`;

const ENTRIES: ReadonlyArray<{ label: string; id?: string }> = [
  { label: "Package", id: TESTNET_SCAN_MARKET_PACKAGE_ID },
  { label: "Market", id: TESTNET_MARKET_ID },
];

function short(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function DeploymentInfo() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, id: string) => {
    await navigator.clipboard.writeText(id).catch(() => undefined);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Deployment info"
        className="fixed bottom-3 right-3 z-40 flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white/40 backdrop-blur transition hover:text-white/70"
      >
        <Info className="h-3 w-3" />
        Sui {NETWORK}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-40 w-64 rounded-lg border border-white/10 bg-black/70 p-3 text-[11px] text-white/60 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wide text-white/80">
          Deployment
        </span>
        <button
          onClick={() => setOpen(false)}
          title="Hide"
          className="text-white/40 transition hover:text-white/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <dl className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-white/40">Network</dt>
          <dd className="font-medium text-white/80">Sui {NETWORK}</dd>
        </div>
        {ENTRIES.map(({ label, id }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-white/40">{label}</dt>
            <dd className="flex items-center gap-1.5">
              {id ? (
                <>
                  <button
                    onClick={() => copy(label, id)}
                    title={`Copy ${id}`}
                    className="flex items-center gap-1 font-mono text-white/80 transition hover:text-white"
                  >
                    {short(id)}
                    {copied === label ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3 text-white/30" />
                    )}
                  </button>
                  <a
                    href={`${EXPLORER}/object/${id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Suiscan"
                    className="text-white/30 transition hover:text-white/80"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : (
                <span className="text-white/30">not set</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
