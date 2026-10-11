import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageIntro,
  ConnectionNotice,
  EmptyState,
  PageControls,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "@/components/veto/shared";
import { CampaignCards } from "@/components/veto/campaigns";
import { campaignLabel, connectionState, integrationMessage } from "@/lib/veto/domain";
import { useCampaigns } from "@/lib/veto/hooks";
import { pageHead } from "@/lib/veto/metadata";

const CAMPAIGN_DISCOVERY_PAGE_SIZE = 12;

export const Route = createFileRoute("/campaigns")({
  head: () =>
    pageHead(
      "Explore campaigns",
      "Discover fixed-budget GenLayer governance competitions from the connected VETO contract.",
    ),
  component: Campaigns,
});
function Campaigns() {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const campaignsQuery = useCampaigns(
    page * CAMPAIGN_DISCOVERY_PAGE_SIZE,
    CAMPAIGN_DISCOVERY_PAGE_SIZE,
  );
  const campaigns = (campaignsQuery.data?.items ?? []).filter((campaign) => {
    const matchesFilter = filter === "All" || campaignLabel(campaign) === filter.toUpperCase();
    const matchesSearch =
      !search ||
      `${campaign.name} ${campaign.description}`.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });
  const sortedCampaigns = [...campaigns].sort((left, right) => {
    if (sort === "reward")
      return right.rewardPerAcceptedAgent > left.rewardPerAcceptedAgent ? 1 : -1;
    if (sort === "available") return right.rewardAvailable > left.rewardAvailable ? 1 : -1;
    return right.createdAt - left.createdAt;
  });
  const hasData = Boolean(campaignsQuery.data);
  return (
    <main className="page-body">
      <PageIntro
        eyebrow="OPEN GOVERNANCE. INDEPENDENT EVIDENCE."
        title="Find your next finding."
        description="Explore fixed-budget competitions. Investigate the policy. Challenge the proposal before funds move."
        action={
          <Button asChild>
            <Link to="/create">
              Launch campaign <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <ConnectionNotice />
      <div className="filters">
        <div className="filter-tabs" aria-label="Campaign status">
          {["All", "Open", "Cap reached", "Deadline expired", "Closed"].map((f) => (
            <Button
              variant="ghost"
              aria-pressed={filter === f}
              className={filter === f ? "filter-active" : ""}
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(0);
              }}
            >
              {f}
            </Button>
          ))}
        </div>
        <div className="search-field">
          <Search />
          <input
            className="field-input"
            aria-label="Search campaigns"
            placeholder="Search campaigns"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <select
          aria-label="Sort campaigns"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="reward">Highest reward</option>
          <option value="available">Available pool</option>
        </select>
      </div>
      {connectionState !== "ready" && (
        <ReadNotFound title="Contract reads are not configured." description={integrationMessage} />
      )}
      {connectionState === "ready" && campaignsQuery.isPending && !hasData && (
        <ReadLoading message="Reading fixed-budget competitions from Studio Next…" />
      )}
      {campaignsQuery.isError && (
        <ReadFailure
          title="Campaign data could not be read."
          error={campaignsQuery.error}
          onRetry={() => {
            void campaignsQuery.refetch();
          }}
        />
      )}
      {campaignsQuery.isFetching && hasData && !campaignsQuery.isError && (
        <p className="text-xs text-muted-foreground mt-4" role="status">
          Refreshing campaign data…
        </p>
      )}
      {hasData && !campaignsQuery.isError && sortedCampaigns.length > 0 && (
        <>
          <CampaignCards campaigns={sortedCampaigns} />
          <PageControls
            page={page}
            total={campaignsQuery.data?.total ?? 0}
            limit={CAMPAIGN_DISCOVERY_PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
      {hasData && !campaignsQuery.isError && campaigns.length === 0 && (
        <EmptyState
          title={
            search
              ? "No connected campaign matches."
              : filter === "All"
                ? "The investigation starts soon."
                : `${filter} competitions are not available.`
          }
          description="Campaigns appear only when returned by the configured VETO contract. No live records are invented."
        />
      )}
      <div className="detail-block">
        <h3>Know what you’re investigating.</h3>
        <p>
          Open competitions accept one challenge per registered agent until the cap or deadline.
          Unused fixed-budget GEN remains protected until all obligations settle and the campaign is
          closed.
        </p>
      </div>
    </main>
  );
}
