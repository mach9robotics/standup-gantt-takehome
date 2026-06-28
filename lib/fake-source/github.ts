// fake-GitHub GraphQL behavior (read-only). The half of the Fake source that
// impersonates GitHub's GraphQL API in GitHub's own wire shape (see README): it
// answers the per-repo pull-request discovery query and is READ-ONLY by design --
// reviews are read-only, just as the real GitHub integration treats them. It rejects
// every mutation.
//
// HTTP-free on purpose, mirroring lib/fake-source/store.ts: the route
// (app/api/fake/github/route.ts) is a thin adapter that hands the parsed GraphQL body
// here, so this behavior seam is unit-testable without Next (jest's testMatch is lib/
// only).

import {
  FAKE_GITHUB_REPOS,
  type RawGithubPullRequestNode,
  type RawGithubPullRequestsPage,
  seedGithubPullRequestsPage,
} from "./seed";

/** A GraphQL request body as fake-GitHub receives it (query string + variables). */
export interface FakeGithubGraphQLRequest {
  query?: string;
  variables?: Record<string, unknown>;
}

interface GraphQLError {
  message: string;
  type?: string;
}

export type FakeGithubGraphQLResponse =
  | { data: { repository: { pullRequests: RawGithubPullRequestsPage } } }
  | { data: { repository: null }; errors: GraphQLError[] }
  | { errors: GraphQLError[] };

/** The error fake-GitHub returns for any write attempt (read-only). */
export const FAKE_GITHUB_READONLY_MESSAGE =
  "fake-GitHub is read-only: it answers the `pullRequests` discovery query only and rejects all writes.";

type PrState = RawGithubPullRequestNode["state"];

function asPrState(value: unknown): PrState {
  return value === "MERGED" || value === "CLOSED" ? value : "OPEN";
}

/**
 * Route a parsed GraphQL request against the seeded PR set and return the response
 * envelope. Read-only: any `mutation` is rejected with a clear error BEFORE the read
 * dispatch, so treating a review as writable gets a faithful refusal. An unknown repo
 * gets GitHub's NOT_FOUND partial success (HTTP 200, `repository: null` + a top-level
 * error), so your normalization has to handle the same per-repo skip the real API forces.
 */
export function executeFakeGithubGraphql(
  body: FakeGithubGraphQLRequest,
  now: Date
): FakeGithubGraphQLResponse {
  const query = body.query ?? "";
  const variables = body.variables ?? {};

  if (/\bmutation\b/i.test(query)) {
    return { errors: [{ message: FAKE_GITHUB_READONLY_MESSAGE }] };
  }

  if (!/\bpullRequests\b/.test(query)) {
    return {
      errors: [
        {
          message:
            "fake-GitHub answers the pull-request discovery query (`pullRequests`) only, and is read-only.",
        },
      ],
    };
  }

  const owner = typeof variables.owner === "string" ? variables.owner : "";
  const name = typeof variables.name === "string" ? variables.name : "";
  const state = asPrState(variables.state);

  const known = FAKE_GITHUB_REPOS.some((r) => r.owner === owner && r.name === name);
  if (!known) {
    return {
      data: { repository: null },
      errors: [
        {
          type: "NOT_FOUND",
          message: `Could not resolve to a Repository with the name '${owner}/${name}'.`,
        },
      ],
    };
  }

  const pullRequests = seedGithubPullRequestsPage(now, owner, name, state);
  return { data: { repository: { pullRequests } } };
}
