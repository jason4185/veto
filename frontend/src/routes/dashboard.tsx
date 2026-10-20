import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import {
  PageIntro,
  ConnectionNotice,
  EmptyState,
  WalletGate,
  PageControls,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "@/components/veto/shared";
import { FundedProposalForm } from "@/components/veto/forms";
import { campaignLabel, connectionState, formatGen, integrationMessage } from "@/lib/veto/domain";
import { simpleWrite } from "@/lib/veto/contract";
import { useAccounting, useMyCampaigns, useWalletAgent } from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pendingScope, usePendingTransactions } from "@/lib/veto/pending";
import { pageHead } from "@/lib/veto/metadata";

export const Route = createFileRoute("/dashboard")({
  head: () =>
    pageHead(
      "Creator dashboard",
      "Manage creator-owned VETO V1 competitions, funded governance proposals, settlement and uncommitted GEN recovery.",
    ),
  component: Dashboard,
});

function Dashboard() {
  const [tab, setTab] = useState("Campaigns");
  const [page, setPage] = useState(0);
  const wallet = useWallet();
  const campaignsQuery = useMyCampaigns(page * 50, 50, wallet.address, wallet.connectedClient);
  const accountingQuery = useAccounting();
  const walletAgentQuery = useWalletAgent(wallet.address, wallet.chainId);
  const pendingTransactions = usePendingTransactions(pendingScope(wallet.address, wallet.chainId));
  const campaigns = campaignsQuery.data?.items ?? [];
  const campaignCreationPending = pendingTransactions.some(
    (record) => record.method === "create_campaign",
  );
  const creatorReadReady =
    connectionState === "ready" &&
    wallet.status === "connected" &&
    Boolean(wallet.address && wallet.connectedClient);

  const campaignReadState = !creatorReadReady ? (
    <div className="detail-block mt-8" role="status">
      <h3>
        {connectionState !== "ready"
          ? "Creator campaigns are not configured"
          : wallet.status === "wrong-network"
            ? "Switch to Studio Next"
            : wallet.status === "connecting"
              ? "Identifying connected wallet"
              : "Connect a creator wallet"}
      </h3>
      <p>
        {connectionState !== "ready"
          ? "The verified VETO deployment address is required before campaign ownership can be read."
          : wallet.status === "wrong-network"
            ? "Creator campaigns are read only from the GenLayer Studio Next network."
            : wallet.status === "connecting"
              ? "Waiting for the browser wallet account before reading creator-owned campaigns."
              : "Connect the wallet that created a campaign to view its on-chain records."}
      </p>
    </div>
  ) : campaignsQuery.isError ? (
    <div className="mt-8">
      <ReadFailure
        title="Creator campaigns could not be read."
        error={campaignsQuery.error}
        onRetry={() => {
          void campaignsQuery.refetch();
        }}
      />
    </div>
  ) : campaignCreationPending && campaigns.length === 0 ? (
    <div className="detail-block mt-8" role="status">
      <h3>Campaign transaction awaiting finality</h3>
      <p>
        The creation transaction has not reached finality yet. VETO campaign data will refresh when
        GenLayer confirms its state.
      </p>
    </div>
  ) : campaignsQuery.isPending && !campaignsQuery.data ? (
    <ReadLoading message="Reading campaign ownership and balances from VETO…" />
  ) : campaignsQuery.data && campaigns.length === 0 ? (
    <EmptyState
      title="No creator campaigns found."
      description="The connected wallet has no campaign records returned by the VETO contract. No local campaign state is used."
    />
  ) : null;
  return (
    <main className="page-body">
      <PageIntro
        eyebrow="CREATOR WORKSPACE"
        title="Govern with a second look."
        description="Every reward balance, proposal escrow and closure action below is read from the VETO contract."
        action={
          <Button asChild>
            <Link to="/create">
              New campaign <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <WalletGate />
      <div className="mt-6">
        <ConnectionNotice />
      </div>
      {walletAgentQuery.data?.agent && (
        <div className="detail-block mt-6">
          <p className="eyebrow">MY AGENT · VERIFIED ONCHAIN</p>
          <h3>{walletAgentQuery.data.agent.name}</h3>
          <p>
            This wallet matches the live owner or operator record for Agent #
            {walletAgentQuery.data.agent.id}.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/agent/$id" params={{ id: walletAgentQuery.data.agent.id }}>
              Open My Agent <ArrowUpRight />
            </Link>
          </Button>
        </div>
      )}
      <div className="detail-tabs">
        {["Campaigns", "Funded proposals", "Settlement"].map((tabName) => (
          <Button
            key={tabName}
            variant="ghost"
            className={tab === tabName ? "filter-active" : ""}
            aria-pressed={tab === tabName}
            onClick={() => setTab(tabName)}
          >
            {tabName}
          </Button>
        ))}
      </div>
      {tab === "Funded proposals" ? (
        <>
          <FundedProposalForm />
          <div className="detail-block mt-10">
            <p>
              Proposal escrow is a separate native GEN obligation. It is never a campaign reward
              budget.
            </p>
          </div>
        </>
      ) : tab === "Settlement" ? (
        <>
          <div className="detail-block mt-8">
            <h3>Global accounting</h3>
            {connectionState !== "ready" ? (
              <ReadNotFound
                title="Settlement reads are not configured."
                description={integrationMessage}
              />
            ) : accountingQuery.isPending && !accountingQuery.data ? (
              <ReadLoading message="Loading settlement accounting from VETO…" />
            ) : accountingQuery.isError ? (
              <ReadFailure
                title="Global accounting could not be read."
                error={accountingQuery.error}
                onRetry={() => {
                  void accountingQuery.refetch();
                }}
              />
            ) : accountingQuery.data ? (
              <dl>
                <dt>Reward funded</dt>
                <dd>{formatGen(accountingQuery.data.rewardFunded)} GEN</dd>
                <dt>Reward reserved</dt>
                <dd>{formatGen(accountingQuery.data.rewardReserved)} GEN</dd>
                <dt>Reward claimable</dt>
                <dd>{formatGen(accountingQuery.data.rewardClaimable)} GEN</dd>
                <dt>Reward paid</dt>
                <dd>{formatGen(accountingQuery.data.rewardPaid)} GEN</dd>
                <dt>Reward refunded</dt>
                <dd>{formatGen(accountingQuery.data.rewardRefunded)} GEN</dd>
                <dt>Escrow locked</dt>
                <dd>{formatGen(accountingQuery.data.escrowLocked)} GEN</dd>
              </dl>
            ) : (
              <p>Global accounting is available only from a configured deployment.</p>
            )}
          </div>
          <div className="detail-block">
            <h3>Safe closure and recovery</h3>
            <p>
              Closing is creator-only and cannot consume reserved or claimable rewards. A remainder
              can be recovered only after the contract reports the campaign closed and all
              obligations are terminal.
            </p>
          </div>
          <div className="detail-block">
            <h3>Creator campaign balances</h3>
            {campaignReadState}
            {creatorReadReady &&
              !campaignsQuery.isPending &&
              !campaignsQuery.isError &&
              campaigns.length > 0 && (
                <div className="campaign-grid mt-6">
                  {campaigns.map((campaign) => (
                    <article className="campaign-card" key={campaign.id}>
                      <span className="eyebrow">{campaignLabel(campaign)}</span>
                      <h3>
                        <Link to="/campaign/$id" params={{ id: campaign.id }}>
                          {campaign.name}
                        </Link>
                      </h3>
                      <p>Campaign #{campaign.id}</p>
                      <dl>
                        <dt>Open proposals</dt>
                        <dd>{campaign.openProposalCount}</dd>
                        <dt>Available</dt>
                        <dd>{formatGen(campaign.rewardAvailable)} GEN</dd>
                        <dt>Reserved</dt>
                        <dd>{formatGen(campaign.rewardReserved)} GEN</dd>
                        <dt>Claimable</dt>
                        <dd>{formatGen(campaign.rewardClaimable)} GEN</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
          </div>
        </>
      ) : campaigns.length ? (
        <div className="campaign-grid mt-8">
          {campaigns.map((campaign) => (
            <article className="campaign-card" key={campaign.id}>
              <span className="eyebrow">{campaignLabel(campaign)}</span>
              <h3>
                <Link to="/campaign/$id" params={{ id: campaign.id }}>
                  {campaign.name}
                </Link>
              </h3>
              <p>
                {campaign.participatingAgents} / {campaign.maxAgents} participants ·{" "}
                {campaign.proposalCount} proposals
              </p>
              <p className="mt-2">
                {campaign.openProposalCount} open proposal
                {campaign.openProposalCount === 1 ? "" : "s"} requiring settlement review
              </p>
              <p className="mt-3">{formatGen(campaign.rewardAvailable)} GEN uncommitted</p>
              <div className="card-bottom">
                <Button asChild variant="outline">
                  <Link to="/campaign/$id" params={{ id: campaign.id }}>
                    Manage proposals <ArrowUpRight />
                  </Link>
                </Button>
                {campaign.canClose && (
                  <ContractAction
                    write={simpleWrite("close_campaign", campaign.id)}
                    label="Close"
                  />
                )}
                {campaign.status === "CLOSED" &&
                  !campaign.remainderClaimed &&
                  campaign.rewardAvailable > 0n && (
                    <ContractAction
                      write={simpleWrite("claim_campaign_remainder", campaign.id)}
                      label="Recover remainder"
                    />
                  )}
              </div>
            </article>
          ))}
          <PageControls
            page={page}
            total={campaignsQuery.data?.total ?? 0}
            limit={50}
            onChange={setPage}
          />
        </div>
      ) : (
        campaignReadState
      )}
    </main>
  );
}
