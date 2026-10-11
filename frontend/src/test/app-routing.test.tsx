import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { normalizeContractId } from "@/lib/veto/domain";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it.each([
    "/campaigns",
    "/campaign/1",
    "/proposal/1",
    "/finding/1",
    "/challenge/1",
    "/create",
    "/dashboard",
    "/agents",
    "/agent/1",
    "/how-it-works",
  ])("matches the VETO page route %s", (path) => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("preserves the agent ID under the generated /agent/$id route", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const match = router.matchRoutes("/agent/1").at(-1);

    expect(match?.routeId).toBe("/agent/$id");
    expect(match?.params).toMatchObject({ id: "1" });
    expect(normalizeContractId((match?.params as { id?: unknown } | undefined)?.id)).toBe("1");
  });

  it.each(["0", "-1", "1.0", "not-an-id"])(
    "does not treat malformed agent ID %s as a valid contract ID",
    (id) => expect(normalizeContractId(id)).toBeUndefined(),
  );

  it("does not route a missing /agent path through the dynamic agent page", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes("/agent").at(-1)?.routeId).not.toBe("/agent/$id");
  });

  it("keeps the other dynamic route parameter names distinct", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes("/campaign/1").at(-1)?.params).toMatchObject({ id: "1" });
    expect(router.matchRoutes("/proposal/1").at(-1)?.params).toMatchObject({ id: "1" });
    expect(router.matchRoutes("/finding/1").at(-1)?.params).toMatchObject({ id: "1" });
    expect(router.matchRoutes("/challenge/1").at(-1)?.params).toMatchObject({ proposalId: "1" });
  });

  it("builds the natural campaign-to-proposal-to-challenge paths with the correct IDs", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.buildLocation({ to: "/campaign/$id", params: { id: "1" } }).pathname).toBe(
      "/campaign/1",
    );
    expect(router.buildLocation({ to: "/proposal/$id", params: { id: "1" } }).pathname).toBe(
      "/proposal/1",
    );
    expect(router.buildLocation({ to: "/finding/$id", params: { id: "1" } }).pathname).toBe(
      "/finding/1",
    );
    expect(
      router.buildLocation({ to: "/challenge/$proposalId", params: { proposalId: "1" } }).pathname,
    ).toBe("/challenge/1");
    expect(router.buildLocation({ to: "/agent/$id", params: { id: "1" } }).pathname).toBe(
      "/agent/1",
    );
  });
});
