import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import { UpdateAgentForm } from "@/components/veto/forms";
import {
  PageIntro,
  ConnectionNotice,
  EmptyState,
  PageControls,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
  VetoErrorNotice,
} from "@/components/veto/shared";
import {
  connectionState,
  agentControlsWallet,
  formatGen,
  integrationMessage,
  normalizeContractId,
  shortAddress,
} from "@/lib/veto/domain";
import { claimRewardWrite } from "@/lib/veto/contract";
import {
  useAgent,
  useAgentCampaignClaimable,
  useAgentChallenges,
  useWalletAgent,
} from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pageHead } from "@/lib/veto/metadata";
import { normalizeVetoError } from "@/lib/veto/errors";
import { readKnownAgentId, rememberKnownAgentId } from "@/lib/veto/agent-memory";

export const Route = createFileRoute("/agent/$id")({
  head: () =>
    pageHead(
      "Agent profile",
      "View a registered VETO agent, its authorized identities, challenge history and finalized GEN rewards.",
    ),
  component: AgentPage,
});

function AgentChallengeRow({
  agentId,
  actor,
  challenge,
}: {
  agentId: string;
  actor: boolean;
  challenge: {
    id: string;
    proposalId: string;
    campaignId: string;
    allegation: string;
    status: string;
    attempts: number;
    accepted: boolean;
  };
}) {
  const claimableQuery = useAgentCampaignClaimable(agentId, challenge.campaignId);
  const canClaim = actor && challenge.accepted && (claimableQuery.data ?? 0n) > 0n;
  return (
    <div className="list-row">
      <div>
        <Link to="/proposal/$id" params={{ id: challenge.proposalId }}>
          <strong>Proposal #{challenge.proposalId}</strong>
        </Link>
        <p className="text-xs mt-2">
          <Link className="text-link" to="/finding/$id" params={{ id: challenge.id }}>
            View finding #{challenge.id} <ArrowUpRight size={13} />
          </Link>
        </p>
        <p>{challenge.allegation}</p>
        <p className="text-xs text-muted-foreground">
          Campaign #{challenge.campaignId} · {challenge.status} · attempts {challenge.attempts}/2
        </p>
      </div>
      <div>
        <span className="eyebrow">{challenge.accepted ? "WINNER" : challenge.status}</span>
        {canClaim && (
          <ContractAction
            write={claimRewardWrite(agentId, challenge.campaignId)}
            label="Claim reward"
          />
        )}
        {claimableQuery.isError && (
          <VetoErrorNotice
            error={claimableQuery.error}
            onRetry={() => {
              void claimableQuery.refetch();
            }}
          />
        )}
      </div>
    </div>
  );
}

function AgentPage() {
  const { id: rawId } = Route.useParams();
  const id = normalizeContractId(rawId);
  const routeHasParameter = typeof rawId === "string" && rawId.trim().length > 0;
  const agentQuery = useAgent(id ?? "");
  const [challengePage, setChallengePage] = useState(0);
  const challengesQuery = useAgentChallenges(id ?? "", challengePage * 50, 50);
  const wallet = useWallet();
  const walletAgentQuery = useWalletAgent(wallet.address, wallet.chainId);
  const walletAgent = walletAgentQuery.data?.agent;
  const [remembered, setRemembered] = useState(false);
  useEffect(() => {
    setRemembered(
      Boolean(
        wallet.address && (readKnownAgentId(wallet.address) === id || walletAgent?.id === id),
      ),
    );
  }, [wallet.address, id, walletAgent?.id]);
  const agent = agentQuery.data;
  if (!routeHasParameter)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="AGENT / MISSING ID"
          title="This agent route is incomplete."
          description="Open an agent profile with a positive on-chain agent ID, such as /agent/1."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Agent ID is missing."
          description="The route did not contain an agent identifier."
        />
      </main>
    );
  if (!id)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="AGENT / INVALID ID"
          title="That agent ID is not valid."
          description="Agent IDs are positive on-chain integers. Open an agent from a verified participant record."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Agent not found."
          description="The route did not contain a valid agent identifier."
        />
      </main>
    );
  if (connectionState !== "ready")
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="AGENT / CONFIGURATION"
          title="Agent reads are not configured."
          description={integrationMessage}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="The VETO deployment is unavailable in this environment."
          description={integrationMessage}
        />
      </main>
    );
  if (agentQuery.isPending && !agent)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="AGENT / READING"
          title="Evidence leaves a record."
          description="Reading the registered agent from Studio Next…"
        />
        <ConnectionNotice />
        <ReadLoading message={`Reading agent #${id} from Studio Next…`} />
      </main>
    );
  if (agentQuery.isError)
    return (
      <main className="page-body">
        <Link to="/agents" className="text-link mt-0 mb-8">
          <ArrowLeft size={13} /> Agent directory
        </Link>
        <PageIntro
          eyebrow={
            normalizeVetoError(agentQuery.error).kind === "contract_state"
              ? "AGENT / NOT FOUND"
              : "AGENT / READ FAILED"
          }
          title={
            normalizeVetoError(agentQuery.error).kind === "contract_state"
              ? `Agent #${id} was not found on-chain.`
              : "Agent data could not be read."
          }
          description={
            normalizeVetoError(agentQuery.error).kind === "contract_state"
              ? "The VETO contract completed the lookup, but no registered agent has this ID."
              : "GenLayer Studio Next did not return a usable agent record. Your on-chain data has not been changed."
          }
        />
        <ConnectionNotice />
        <ReadFailure
          error={agentQuery.error}
          {...(normalizeVetoError(agentQuery.error).kind === "contract_state"
            ? {}
            : {
                onRetry: () => {
                  void agentQuery.refetch();
                },
              })}
        />
      </main>
    );
  if (!agent)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="AGENT / NOT FOUND"
          title={`Agent #${id} was not found on-chain.`}
          description="The read completed successfully, but the contract returned no record for this ID."
        />
        <ConnectionNotice />
        <ReadNotFound
          title={`Agent #${id} was not found on-chain.`}
          description="The VETO contract returned an empty record for this valid ID."
        />
      </main>
    );
  const actor = Boolean(agentControlsWallet(agent, wallet.address));
  return (
    <main className="page-body">
      <Link to="/agents" className="text-link mt-0 mb-8">
        <ArrowLeft size={13} /> Agent directory
      </Link>
      <PageIntro
        eyebrow={`AGENT / ${agent.active ? "ACTIVE" : "INACTIVE"}`}
        title={agent.name}
        description={agent.description}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/campaigns">
                Find campaigns to challenge <ArrowUpRight />
              </Link>
            </Button>
            {actor && wallet.address && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemembered(rememberKnownAgentId(wallet.address, id))}
              >
                {remembered ? "Saved as My Agent" : "Remember as My Agent"}
              </Button>
            )}
          </div>
        }
      />
      <ConnectionNotice />
      {wallet.address && walletAgentQuery.isPending && !walletAgent && (
        <ReadLoading message="Checking whether this is your verified agent…" />
      )}
      {wallet.address && walletAgentQuery.isError && (
        <ReadFailure
          title="Automatic agent recognition is unavailable."
          error={walletAgentQuery.error}
          onRetry={() => {
            void walletAgentQuery.refetch();
          }}
        />
      )}
      {wallet.address && walletAgent && walletAgent.id === agent.id && (
        <div className="detail-block mt-7">
          <p className="eyebrow">MY AGENT · VERIFIED ONCHAIN</p>
          <h3>{walletAgent.name}</h3>
          <p>
            This wallet matches the live{" "}
            {walletAgent.owner.toLowerCase() === wallet.address.toLowerCase()
              ? "owner"
              : "operator"}{" "}
            record for Agent #{walletAgent.id}.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button asChild variant="outline">
              <Link to="/campaigns">
                Explore campaigns <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </div>
      )}
      {wallet.address && walletAgent && walletAgent.id !== agent.id && (
        <div className="detail-block mt-7">
          <p className="eyebrow">MY AGENT · #{walletAgent.id}</p>
          <p>
            This wallet is verified for {walletAgent.name}. The profile open here is a different
            on-chain agent.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/agent/$id" params={{ id: walletAgent.id }}>
              View My Agent <ArrowUpRight />
            </Link>
          </Button>
        </div>
      )}
      <div className="metrics">
        {[
          ["Agent ID", `#${agent.id}`],
          ["Owner", shortAddress(agent.owner)],
          ["Operator", shortAddress(agent.operator)],
          ["Payout address", shortAddress(agent.payoutAddress)],
          ["Claimable GEN", formatGen(agent.claimable)],
          ["Accepted findings", String(agent.acceptedCount)],
          ["Total earned", `${formatGen(agent.totalEarned)} GEN`],
        ].map(([title, value]) => (
          <div className="metric" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>Authoritative contract value</small>
          </div>
        ))}
      </div>
      <div className="detail-block mt-7">
        <h3>Challenge history</h3>
        {challengesQuery.isPending && !challengesQuery.data && (
          <ReadLoading message="Reading agent challenge history…" />
        )}
        {challengesQuery.isError && (
          <ReadFailure
            title="Challenge history could not be read."
            error={challengesQuery.error}
            onRetry={() => {
              void challengesQuery.refetch();
            }}
          />
        )}
        {challengesQuery.data?.items.map((challenge) => (
          <AgentChallengeRow agentId={id} actor={actor} challenge={challenge} key={challenge.id} />
        ))}
        {challengesQuery.data &&
          !challengesQuery.isError &&
          challengesQuery.data.items.length === 0 && (
            <EmptyState
              title="No challenge history returned."
              description="Challenge records are paginated by the contract."
              action={false}
            />
          )}
        <PageControls
          page={challengePage}
          total={challengesQuery.data?.total ?? 0}
          limit={50}
          onChange={setChallengePage}
        />
      </div>
      {wallet.address && wallet.address.toLowerCase() === agent.owner.toLowerCase() && (
        <div className="detail-block mt-7">
          <UpdateAgentForm agent={agent} />
        </div>
      )}
    </main>
  );
}
