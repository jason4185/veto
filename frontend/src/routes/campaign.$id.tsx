import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import {
  PageIntro,
  ConnectionNotice,
  EmptyState,
  PageControls,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "@/components/veto/shared";
import {
  campaignLabel,
  connectionState,
  formatDuration,
  formatGen,
  formatPolicy,
  integrationMessage,
  normalizeContractId,
  shortAddress,
  VETO_LIMITS,
} from "@/lib/veto/domain";
import { useCampaign, useCampaignParticipants, useCampaignProposals } from "@/lib/veto/hooks";
import { simpleWrite } from "@/lib/veto/contract";
import { useWallet } from "@/lib/veto/wallet";
import { pageHead } from "@/lib/veto/metadata";
import { normalizeVetoError } from "@/lib/veto/errors";

export const Route = createFileRoute("/campaign/$id")({
  head: () =>
    pageHead(
      "Campaign details",
      "Inspect an onchain VETO V1 fixed-budget competition, its policies, proposals, participation capacity and GEN accounting.",
    ),
  component: CampaignPage,
});

function CampaignPage() {
  const { id: rawId } = Route.useParams();
  const id = normalizeContractId(rawId);
  const campaignQuery = useCampaign(id ?? "");
  const campaign = campaignQuery.data;
  const [proposalPage, setProposalPage] = useState(0);
  const [participantPage, setParticipantPage] = useState(0);
  const proposalsQuery = useCampaignProposals(id ?? "", proposalPage * 50, 50);
  const participantsQuery = useCampaignParticipants(id ?? "", participantPage * 50, 50);
  const wallet = useWallet();
  const owned = Boolean(
    campaign && wallet.address && campaign.creator.toLowerCase() === wallet.address.toLowerCase(),
  );
  const [now] = [Math.floor(Date.now() / 1000)];
  if (!id)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="CAMPAIGN / INVALID ID"
          title="That campaign ID is not valid."
          description="Campaign IDs are positive on-chain integers. Open a campaign from the verified listing."
        />
        <ConnectionNotice />
        <ReadNotFound
          title="Campaign not found."
          description="The route did not contain a valid campaign identifier."
        />
      </main>
    );
  if (connectionState !== "ready")
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="CAMPAIGN / CONFIGURATION"
          title="Campaign reads are not configured."
          description={integrationMessage}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="The VETO deployment is unavailable in this environment."
          description={integrationMessage}
        />
      </main>
    );
  if (campaignQuery.isPending && !campaign)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="CAMPAIGN / READING"
          title="Campaign details."
          description="Reading the authoritative VETO record from Studio Next…"
        />
        <ConnectionNotice />
        <ReadLoading message={`Reading campaign #${id} from Studio Next…`} />
      </main>
    );
  if (campaignQuery.isError)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="CAMPAIGN / READ FAILED"
          title={
            normalizeVetoError(campaignQuery.error).kind === "contract_state"
              ? "Campaign not found."
              : "Campaign data could not be read."
          }
          description={`The VETO contract did not provide a usable record for campaign #${id}.`}
        />
        <ConnectionNotice />
        <ReadFailure
          error={campaignQuery.error}
          onRetry={() => {
            void campaignQuery.refetch();
          }}
        />
      </main>
    );
  if (!campaign)
    return (
      <main className="page-body">
        <PageIntro
          eyebrow="CAMPAIGN / NOT FOUND"
          title="Campaign not found."
          description={`Campaign #${id} was not returned by the configured contract.`}
        />
        <ConnectionNotice />
        <ReadNotFound
          title="No campaign record returned."
          description="The read completed successfully, but this campaign ID does not exist."
        />
      </main>
    );
  return (
    <main className="page-body">
      <Link to="/campaigns" className="text-link mt-0 mb-8">
        <ArrowLeft size={13} /> All campaigns
      </Link>
      <PageIntro
        eyebrow={`CAMPAIGN / ${campaignLabel(campaign)}`}
        title={campaign.name}
        description={campaign.description}
        action={
          owned && campaign.canClose ? (
            <ContractAction
              write={simpleWrite("close_campaign", campaign.id)}
              label="Close campaign"
            />
          ) : undefined
        }
      />
      <ConnectionNotice />
      <div className="metrics">
        {[
          ["Reward / winner", `${formatGen(campaign.rewardPerAcceptedAgent)} GEN`],
          ["Participants", `${campaign.participatingAgents} / ${campaign.maxAgents}`],
          ["Slots remaining", String(campaign.remainingAgentSlots)],
          [
            "Deadline",
            campaign.deadline ? new Date(campaign.deadline * 1000).toLocaleString() : "—",
          ],
          ["Available GEN", formatGen(campaign.rewardAvailable)],
          ["Reserved GEN", formatGen(campaign.rewardReserved)],
          ["Claimable GEN", formatGen(campaign.rewardClaimable)],
          [
            "Paid / refunded",
            `${formatGen(campaign.rewardPaid)} / ${formatGen(campaign.rewardRefunded)}`,
          ],
        ].map(([title, value]) => (
          <div className="metric" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>
              {title === "Deadline"
                ? campaign.intakeOpen
                  ? `${Math.max(0, campaign.deadline - now).toLocaleString()}s remaining`
                  : "Intake closed"
                : "Authoritative contract value"}
            </small>
          </div>
        ))}
      </div>
      <div className="detail-grid mt-7">
        <div>
          <div className="detail-block">
            <h3>Competition terms</h3>
            <dl>
              <dt>Creator</dt>
              <dd>{shortAddress(campaign.creator)}</dd>
              <dt>Duration</dt>
              <dd>{formatDuration(campaign.durationSeconds)}</dd>
              <dt>Fixed funding</dt>
              <dd>{formatGen(campaign.rewardFunded)} GEN</dd>
              <dt>Accepted winners</dt>
              <dd>{campaign.acceptedAgents}</dd>
              <dt>Proposals</dt>
              <dd>{campaign.proposalCount}</dd>
            </dl>
          </div>
          <div className="detail-block">
            <h3>Governing policies</h3>
            {campaign.policies.map((policy, index) => (
              <p key={`${index}-${policy}`}>
                {index + 1}. {formatPolicy(policy)}
              </p>
            ))}
          </div>
        </div>
        <aside>
          <div className="detail-block">
            <h3>Reward accounting</h3>
            <p>
              Reward pool and proposal escrow are separate ledgers. Earned but unclaimed rewards
              remain protected after closure.
            </p>
            <dl>
              <dt>Available</dt>
              <dd>{formatGen(campaign.rewardAvailable)} GEN</dd>
              <dt>Reserved</dt>
              <dd>{formatGen(campaign.rewardReserved)} GEN</dd>
              <dt>Claimable</dt>
              <dd>{formatGen(campaign.rewardClaimable)} GEN</dd>
              <dt>Paid</dt>
              <dd>{formatGen(campaign.rewardPaid)} GEN</dd>
              <dt>Refunded</dt>
              <dd>{formatGen(campaign.rewardRefunded)} GEN</dd>
            </dl>
            {owned &&
              campaign.status === "CLOSED" &&
              !campaign.remainderClaimed &&
              campaign.rewardAvailable > 0n && (
                <ContractAction
                  write={simpleWrite("claim_campaign_remainder", campaign.id)}
                  label="Recover uncommitted remainder"
                />
              )}
            {owned && campaign.status === "ACTIVE" && !campaign.canClose && (
              <p className="text-xs text-muted-foreground mt-4">
                Closure is unavailable until intake has ended, all open proposals are terminal, and
                no reward reservations remain.
              </p>
            )}
          </div>
          <div className="detail-block">
            <h3>Participation</h3>
            <p>
              Each registered agent can submit once in this campaign. A rejected finding consumes
              its slot; separate wallets cannot be proven to belong to different people.
            </p>
            {participantsQuery.isPending && !participantsQuery.data && (
              <ReadLoading message="Reading participant records…" />
            )}
            {participantsQuery.isError && (
              <ReadFailure
                title="Participant data could not be read."
                error={participantsQuery.error}
                onRetry={() => {
                  void participantsQuery.refetch();
                }}
              />
            )}
            {participantsQuery.data?.items.map((participant) => (
              <p key={participant.agentId}>
                <Link className="text-link" to="/agent/$id" params={{ id: participant.agentId }}>
                  Agent #{participant.agentId}
                </Link>{" "}
                · {participant.status} ·{" "}
                <Link
                  className="text-link"
                  to="/finding/$id"
                  params={{ id: participant.challengeId }}
                >
                  Finding #{participant.challengeId}
                </Link>
                {participant.accepted ? " · winner" : ""}
              </p>
            ))}
            {participantsQuery.data &&
              !participantsQuery.isError &&
              participantsQuery.data.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No participants returned.</p>
              )}
            <PageControls
              page={participantPage}
              total={participantsQuery.data?.total ?? 0}
              limit={50}
              onChange={setParticipantPage}
            />
          </div>
        </aside>
      </div>
      <div className="detail-block mt-7">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">GOVERNANCE PROPOSALS</p>
            <h2>Investigate the payment.</h2>
          </div>
          {owned && campaign.intakeOpen && (
            <Button asChild>
              <Link to="/dashboard">
                Add proposal <ArrowUpRight />
              </Link>
            </Button>
          )}
        </div>
        {proposalsQuery.isPending && !proposalsQuery.data && (
          <ReadLoading message="Reading funded proposal records…" />
        )}
        {proposalsQuery.isError && (
          <ReadFailure
            title="Proposal data could not be read."
            error={proposalsQuery.error}
            onRetry={() => {
              void proposalsQuery.refetch();
            }}
          />
        )}
        {proposalsQuery.data?.items.map((proposal) => (
          <div className="list-row" key={proposal.id}>
            <div>
              <Link to="/proposal/$id" params={{ id: proposal.id }}>
                <strong>{proposal.title}</strong>
              </Link>
              <p>{proposal.description}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link to="/proposal/$id" params={{ id: proposal.id }}>
                    View proposal <ArrowUpRight />
                  </Link>
                </Button>
                {campaign.intakeOpen &&
                  ["OPEN", "PENDING"].includes(proposal.stage) &&
                  proposal.challengeCount < VETO_LIMITS.challengesPerProposal && (
                    <Button asChild size="sm">
                      <Link to="/challenge/$proposalId" params={{ proposalId: proposal.id }}>
                        Challenge Proposal <ArrowUpRight />
                      </Link>
                    </Button>
                  )}
              </div>
            </div>
            <span className="eyebrow">
              {proposal.stage} · {formatGen(proposal.paymentAmount)} GEN escrow
            </span>
          </div>
        ))}
        <PageControls
          page={proposalPage}
          total={proposalsQuery.data?.total ?? 0}
          limit={50}
          onChange={setProposalPage}
        />
        {proposalsQuery.data &&
          !proposalsQuery.isError &&
          proposalsQuery.data.items.length === 0 && (
            <EmptyState
              title="No proposals registered yet."
              description="The campaign creator can fund proposals while intake remains open."
              action={false}
            />
          )}
      </div>
    </main>
  );
}
