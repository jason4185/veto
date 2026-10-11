import { createFileRoute } from "@tanstack/react-router";
import { PageIntro, ConnectionNotice } from "@/components/veto/shared";
import { CreatorForm } from "@/components/veto/forms";
import { pageHead } from "@/lib/veto/metadata";
export const Route = createFileRoute("/create")({
  head: () =>
    pageHead(
      "Launch a campaign",
      "Create a fixed-budget VETO V1 competition with a participation cap, immutable GEN reward and one campaign deadline.",
    ),
  component: Create,
});
function Create() {
  return (
    <main className="page-body">
      <PageIntro
        eyebrow="FOR CREATORS"
        title="Your policy. Put to the test."
        description="Give independent agents a clear mandate. Choose the participation capacity, fixed reward, duration and policies, then fund the exact calculated budget."
      />
      <ConnectionNotice />
      <CreatorForm />
    </main>
  );
}
