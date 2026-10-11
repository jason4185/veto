import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Unplug,
  Wallet,
  X,
  Menu,
  ChevronDown,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/veto/wallet";
import { chainConfig, integrationMessage, connectionState } from "@/lib/veto/domain";
import { normalizeVetoError } from "@/lib/veto/errors";

export function VetoErrorNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void | Promise<void>;
}) {
  const normalized = normalizeVetoError(error);
  const message =
    normalized.kind === "unknown" && (typeof error === "string" || error instanceof Error)
      ? error instanceof Error
        ? error.message
        : error
      : normalized.message;
  return (
    <div role="alert" className="form-error">
      <p>{message}</p>
      <p className="text-xs mt-2">Next step: {normalized.nextAction}</p>
      {normalized.technicalMessage && (
        <details className="mt-2 text-xs">
          <summary>Technical details</summary>
          <code className="mt-2 block break-words whitespace-pre-wrap">
            {normalized.technicalMessage}
          </code>
        </details>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void onRetry()}
        >
          Retry read
        </Button>
      )}
    </div>
  );
}

export function ReadLoading({
  message = "Reading authoritative VETO data…",
}: {
  message?: string;
}) {
  return (
    <div className="detail-block" role="status" aria-live="polite">
      <p>{message}</p>
    </div>
  );
}

export function ReadFailure({
  title = "On-chain data is unavailable.",
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void | Promise<void>;
}) {
  return (
    <div className="detail-block" role="alert">
      <h3>{title}</h3>
      <VetoErrorNotice error={error} {...(onRetry ? { onRetry } : {})} />
    </div>
  );
}

export function ReadNotFound({ title, description }: { title: string; description: string }) {
  return (
    <div className="detail-block" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Logo() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M5 5h22v13L16 28 5 18V5Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="m21 4-10 20" stroke="currentColor" strokeWidth="2.8" />
      </svg>
      VETO<span className="logo-period">.</span>
    </span>
  );
}
export function SiteHeader() {
  const [menu, setMenu] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const wallet = useWallet();
  return (
    <>
      <header className="site-header">
        <Link to="/" aria-label="VETO home">
          <Logo />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link to="/campaigns" activeProps={{ className: "nav-active" }}>
            Explore
          </Link>
          <Link to="/how-it-works" activeProps={{ className: "nav-active" }}>
            How it works
          </Link>
          <Link to="/agents" activeProps={{ className: "nav-active" }}>
            For agents <ArrowUpRight size={12} />
          </Link>
        </nav>
        <div className="header-actions">
          <Button variant="outline" className="wallet-button" onClick={() => setWalletOpen(true)}>
            {wallet.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : "Connect wallet"}
            {wallet.address ? <ChevronDown /> : <ArrowUpRight />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="mobile-menu-button"
            aria-label={menu ? "Close menu" : "Open menu"}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </Button>
        </div>
      </header>
      {menu && (
        <nav className="mobile-nav" aria-label="Mobile navigation" onClick={() => setMenu(false)}>
          <Link to="/campaigns">
            Explore campaigns <ArrowUpRight />
          </Link>
          <Link to="/how-it-works">
            How it works <ArrowUpRight />
          </Link>
          <Link to="/agents">
            For agents <ArrowUpRight />
          </Link>
          <Link to="/create">
            Launch campaign <ArrowUpRight />
          </Link>
          <Link to="/dashboard">
            Creator dashboard <ArrowUpRight />
          </Link>
        </nav>
      )}
      {walletOpen && (
        <div className="modal-backdrop" onClick={() => setWalletOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Wallet size={26} />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close wallet dialog"
                onClick={() => setWalletOpen(false)}
              >
                <X />
              </Button>
            </div>
            <h2 id="wallet-title">{wallet.address ? "Your wallet" : "Connect to VETO"}</h2>
            <p className="text-muted-foreground">GenLayer Studio Next · Native GEN</p>
            {wallet.address ? (
              <>
                <p className="address-text">{wallet.address}</p>
                <p className="text-sm text-muted-foreground">
                  {wallet.chainId === chainConfig.chainId
                    ? "Studio Next network detected"
                    : "Your wallet is on a different network."}
                </p>
                {wallet.chainId !== chainConfig.chainId && (
                  <Button onClick={wallet.switchChain} disabled={wallet.busy}>
                    Switch to Studio Next
                  </Button>
                )}
                <Button variant="outline" onClick={wallet.disconnect}>
                  Disconnect from VETO
                </Button>
                <Link to="/dashboard" onClick={() => setWalletOpen(false)} className="text-link">
                  Creator dashboard <ArrowRight size={15} />
                </Link>
              </>
            ) : (
              <>
                <p>
                  Connect your browser wallet to identify your account. No signature or transaction
                  is requested.
                </p>
                <Button onClick={wallet.connect} disabled={wallet.busy}>
                  {wallet.busy ? "Waiting for wallet…" : "Connect browser wallet"}
                  <ArrowUpRight />
                </Button>
              </>
            )}
            {wallet.error && <VetoErrorNotice error={wallet.error} />}
            <div className="modal-note">
              Transaction state is only reported after Studio Next execution succeeds. An accepted
              submission is not itself final contract success.
            </div>
          </section>
        </div>
      )}
    </>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Link to="/">
          <Logo />
        </Link>
        <p>Find the flaw. Prove it. Earn GEN.</p>
      </div>
      <nav aria-label="Footer navigation">
        <Link to="/campaigns">Explore</Link>
        <Link to="/create">For creators</Link>
        <Link to="/agents">For agents</Link>
        <Link to="/how-it-works">How it works</Link>
      </nav>
      <div className="footer-bottom">
        <span>© 2026 VETO</span>
        <span>
          Built for GenLayer <ArrowUpRight size={12} />
        </span>
        <span>Governance, with a second look.</span>
      </div>
    </footer>
  );
}
export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="intro-description">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function ConnectionNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`connection-notice ${compact ? "compact" : ""}`}>
      <span className="status-dot" />
      <div>
        <strong>
          {connectionState === "unconfigured"
            ? "Contract not connected yet"
            : "VETO V1 deployment configured"}
        </strong>
        {!compact && <p>{integrationMessage}</p>}
      </div>
      <Link to="/how-it-works" className="notice-link" aria-label="Read about contract readiness">
        {compact ? (
          <ArrowUpRight size={16} />
        ) : (
          <>
            About VETO <ArrowUpRight size={14} />
          </>
        )}
      </Link>
    </div>
  );
}
export function EmptyState({
  title = "A clean slate. A stronger standard.",
  description = "No live campaigns to display. Once the audited VETO contract is connected, onchain campaigns will appear here.",
  action = true,
}: {
  title?: string;
  description?: string;
  action?: boolean;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        <ShieldCheck size={30} strokeWidth={1} />
      </div>
      <p className="eyebrow">AWAITING ONCHAIN DATA</p>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Button variant="outline" asChild>
          <Link to="/create">
            Prepare a campaign <ArrowUpRight />
          </Link>
        </Button>
      )}
      <span className="empty-state-footnote">
        <Unplug size={12} /> No simulated campaigns. No invented outcomes.
      </span>
    </div>
  );
}
export function PageControls({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}) {
  const previous = page > 0;
  const next = (page + 1) * limit < total;
  if (!previous && !next) return null;
  const start = page * limit + 1;
  const end = Math.min((page + 1) * limit, total);
  return (
    <div className="flex items-center justify-between gap-4 mt-6">
      <span className="text-xs text-muted-foreground">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!previous}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!next}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function WalletGate() {
  const wallet = useWallet();
  return (
    <div className="wallet-gate">
      <Wallet size={19} />
      <div>
        <strong>{wallet.address ? "Wallet identified" : "A wallet is required to submit"}</strong>
        <p>
          {wallet.address
            ? wallet.chainId === chainConfig.chainId
              ? connectionState === "ready"
                ? "Connected to GenLayer Studio Next. Contract writes are available after review."
                : "Wallet connected, but the verified VETO deployment address is not configured."
              : "Switch to GenLayer Studio Next before any transaction."
            : "You can prepare and review your details before connecting."}
        </p>
        {wallet.error && <VetoErrorNotice error={wallet.error} />}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={wallet.busy}
        onClick={
          wallet.address
            ? wallet.chainId !== chainConfig.chainId
              ? wallet.switchChain
              : wallet.disconnect
            : wallet.connect
        }
      >
        {wallet.address
          ? wallet.chainId !== chainConfig.chainId
            ? "Switch network"
            : "Disconnect"
          : wallet.busy
            ? "Connecting…"
            : "Connect wallet"}
      </Button>
    </div>
  );
}
export function Lifecycle({ full = false }: { full?: boolean }) {
  return (
    <div className="lifecycle">
      <div className="lifecycle-top">
        <span className="eyebrow">TWO POOLS. ONE ORDERED RULE.</span>
        <span className="diagram-label">ILLUSTRATIVE LIFECYCLE</span>
      </div>
      <div className="fund-flow">
        <div className="fund-node">
          <span className="node-index">01 / CAMPAIGN</span>
          <h3>Reward pool</h3>
          <p>Creator-funded GEN</p>
          <div className="node-divider" />
          <span>
            One fixed reward reserved
            <br />
            for each recorded participant
          </span>
        </div>
        <div className="flow-connector">
          <span />
          <ShieldCheck size={25} strokeWidth={1.2} />
          <span />
        </div>
        <div className="fund-node">
          <span className="node-index">02 / PROPOSAL</span>
          <h3>Proposal escrow</h3>
          <p>Separately funded GEN</p>
          <div className="node-divider" />
          <span>
            Payment held while agents
            <br />
            check the governing policy
          </span>
        </div>
      </div>
      <div className="flow-decision">
        <span className="decision-line" />
        <p>GenLayer evaluates policy & evidence immediately</p>
        <span className="decision-line" />
      </div>
      <div className="outcome-grid">
        <div>
          <span className="outcome-icon">↗</span>
          <div>
            <h4>Cleared</h4>
            <p>
              No valid challenge after intake closes.
              <br />
              Payment may execute.
            </p>
          </div>
        </div>
        <div>
          <span className="outcome-icon">∕</span>
          <div>
            <h4>Vetoed</h4>
            <p>
              Earliest valid finding wins.
              <br />
              Proposal funder is refunded.
            </p>
          </div>
        </div>
      </div>
      {full && (
        <p className="lifecycle-note">
          Reward pool ≠ proposal escrow. A participant slot is consumed once, while unused reward
          reservations return to the campaign after terminal resolution.
        </p>
      )}
    </div>
  );
}
