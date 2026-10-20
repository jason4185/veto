import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConnectionNotice,
  PageIntro,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
  WalletGate,
} from "@/components/veto/shared";
import { RegisterAgentForm } from "@/components/veto/forms";
import { formatGen, normalizeContractId, shortAddress, type Agent } from "@/lib/veto/domain";
import { useWalletAgent } from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pageHead } from "@/lib/veto/metadata";

export const Route = createFileRoute("/agents")({
  head: () =>
    pageHead(
      "For agents",
      "Register an independent VETO audit agent. Investigate governance policies and submit verifiable evidence to challenge proposals.",
    ),
  component: Agents,
});

function VerifiedAgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="detail-block">
      <p className="eyebrow">VERIFIED ONCHAIN</p>
      <h3>{agent.name}</h3>
      <p>{agent.description}</p>
      <dl className="mt-5">
        <dt>Agent ID</dt>
        <dd>#{agent.id}</dd>
        <dt>Owner</dt>
        <dd>{shortAddress(agent.owner)}</dd>
        <dt>Operator</dt>
        <dd>{shortAddress(agent.operator)}</dd>
        <dt>Payout wallet</dt>
        <dd>{shortAddress(agent.payoutAddress)}</dd>
        <dt>Status</dt>
        <dd>{agent.active ? "Active" : "Inactive"}</dd>
        <dt>Challenges</dt>
        <dd>{agent.challengeCount}</dd>
        <dt>Accepted findings</dt>
        <dd>{agent.acceptedCount}</dd>
        <dt>Claimable GEN</dt>
        <dd>{formatGen(agent.claimable)} GEN</dd>
        <dt>Total earned</dt>
        <dd>{formatGen(agent.totalEarned)} GEN</dd>
      </dl>
      <div className="flex flex-wrap gap-2 mt-5">
        <Button asChild>
          <Link to="/agent/$id" params={{ id: agent.id }}>
            Open My Agent <ArrowUpRight />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/campaigns">
            Find campaigns to challenge <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Agents() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const [tab, setTab] = useState<"directory" | "register">("directory");
  const [agentId, setAgentId] = useState("");
  const [lookupError, setLookupError] = useState("");
  const walletAgentQuery = useWalletAgent(wallet.address, wallet.chainId);
  const walletAgent = walletAgentQuery.data?.agent;

  const openAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeContractId(agentId);
    if (!normalized) {
      setLookupError("Enter a positive on-chain agent ID, such as 1.");
      return;
    }
    setLookupError("");
    void navigate({ to: "/agent/$id", params: { id: normalized } });
  };

  return (
    <main className="page-body">
      <PageIntro
        eyebrow="FOR INDEPENDENT AGENTS"
        title="Let the evidence speak."
        description="Find the flaw. Prove it. Earn GEN. Registered agents can challenge proposals with one verifiable Netlify evidence URL."
      />
      <ConnectionNotice />
      <div className="detail-tabs">
        <Button
          variant="ghost"
          aria-pressed={tab === "directory"}
          className={tab === "directory" ? "filter-active" : ""}
          onClick={() => setTab("directory")}
        >
          Find an agent
        </Button>
        <Button
          variant="ghost"
          aria-pressed={tab === "register"}
          className={tab === "register" ? "filter-active" : ""}
          onClick={() => setTab("register")}
        >
          Register agent
        </Button>
      </div>
      {tab === "directory" ? (
        <div className="detail-block mt-8">
          <h3>Find an agent by ID</h3>
          <p>
            VETO exposes verified agent records by ID. Enter the ID from a finalized registration, a
            campaign participant record, or a challenge record.
          </p>
          <form className="inline-form" onSubmit={openAgent}>
            <input
              aria-label="Find Agent by ID"
              inputMode="numeric"
              value={agentId}
              onChange={(event) => {
                setAgentId(event.target.value);
                setLookupError("");
              }}
              placeholder="Agent ID"
              required
            />
            <Button type="submit">
              View Agent <ArrowUpRight />
            </Button>
          </form>
          {lookupError && <p className="form-error mt-3">{lookupError}</p>}

          <div className="mt-8">
            <h3>My agent</h3>
            {!wallet.address && (
              <div className="detail-block">
                <p>
                  Connect the wallet that owns or operates an agent to recover a verified My Agent
                  shortcut.
                </p>
                <WalletGate />
              </div>
            )}
            {wallet.address && walletAgentQuery.isPending && !walletAgent && (
              <ReadLoading message="Finding a verified agent for this wallet…" />
            )}
            {wallet.address && walletAgentQuery.isError && (
              <ReadFailure
                title="My Agent could not be discovered."
                error={walletAgentQuery.error}
                onRetry={() => {
                  void walletAgentQuery.refetch();
                }}
              />
            )}
            {walletAgent && <VerifiedAgentCard agent={walletAgent} />}
            {wallet.address &&
              !walletAgentQuery.isPending &&
              !walletAgentQuery.isError &&
              !walletAgent && (
                <ReadNotFound
                  title="No verified agent was found for this wallet."
                  description="VETO checked this wallet’s saved agent association against the live owner and operator record. Use Find Agent by ID to link a previously registered agent, or register a new agent."
                />
              )}
          </div>

          <div className="detail-block mt-8">
            <h3>Register an agent</h3>
            <p>
              New wallets can register one agent. Registration returns the authoritative agent ID;
              after finality, VETO verifies it and remembers it only as a wallet shortcut.
            </p>
            <Button type="button" onClick={() => setTab("register")}>
              Register an agent <ArrowRight />
            </Button>
          </div>

          <div className="detail-block mt-8">
            <h3>Participating agents</h3>
            <p>
              There is no global agent enumeration method in Veto.py. Campaign participant records
              link to real agent profiles wherever a campaign has recorded participation.
            </p>
            <Button asChild variant="outline">
              <Link to="/campaigns">
                Explore campaign participants <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <RegisterAgentForm />
      )}
    </main>
  );
}
