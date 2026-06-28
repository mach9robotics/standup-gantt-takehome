// fake-GitHub behavior seam (reads + read-only write rejection). Tests that the
// discovery query returns seeded PRs, an unknown repo gets GitHub's NOT_FOUND partial
// success, and every mutation is rejected with a clear read-only error. No HTTP: the
// route is a thin adapter over executeFakeGithubGraphql (jest's testMatch is lib/ only).

import {
  executeFakeGithubGraphql,
  FAKE_GITHUB_READONLY_MESSAGE,
  type FakeGithubGraphQLResponse,
} from "./github";
import { type RawGithubPullRequestsPage } from "./seed";

const NOW = new Date("2026-06-27T12:00:00.000Z");

const DISCOVERY =
  "query Discover($owner: String!, $name: String!, $state: PullRequestState!) { repository(owner: $owner, name: $name) { pullRequests(states: [$state]) { nodes { number } pageInfo { hasNextPage } } } }";

describe("fake-GitHub reads", () => {
  it("returns a repo's PRs in the requested state", () => {
    const res = executeFakeGithubGraphql(
      { query: DISCOVERY, variables: { owner: "orbital", name: "voyager", state: "OPEN" } },
      NOW
    ) as { data: { repository: { pullRequests: RawGithubPullRequestsPage } } };
    expect(res.data.repository.pullRequests.nodes.length).toBeGreaterThan(0);
  });

  it("answers an unknown repo with GitHub's NOT_FOUND partial success", () => {
    const res = executeFakeGithubGraphql(
      { query: DISCOVERY, variables: { owner: "orbital", name: "nope", state: "OPEN" } },
      NOW
    ) as { data: { repository: null }; errors: Array<{ type?: string }> };
    expect(res.data.repository).toBeNull();
    expect(res.errors[0]?.type).toBe("NOT_FOUND");
  });

  it("rejects an unsupported read query", () => {
    const res = executeFakeGithubGraphql({ query: "query { viewer { login } }" }, NOW);
    expect("errors" in res && res.errors[0]!.message).toMatch(/pull-request discovery query/);
  });
});

describe("fake-GitHub is read-only", () => {
  const mutations = [
    "mutation { addPullRequestReview(input: { pullRequestId: \"x\" }) { clientMutationId } }",
    "mutation RequestReview { requestReviews(input: {}) { clientMutationId } }",
    "mutation { mergePullRequest(input: { pullRequestId: \"x\" }) { clientMutationId } }",
  ];

  it.each(mutations)("rejects the write `%s` with a read-only error", (query) => {
    const res: FakeGithubGraphQLResponse = executeFakeGithubGraphql({ query }, NOW);
    expect("errors" in res).toBe(true);
    if ("errors" in res) expect(res.errors[0]!.message).toBe(FAKE_GITHUB_READONLY_MESSAGE);
  });
});
