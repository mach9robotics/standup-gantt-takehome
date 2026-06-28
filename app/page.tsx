"use client";

// Starting skeleton: a near-empty home page with a single working example fetch
// against the Fake source, so you can confirm data is flowing and see the raw
// Linear + GitHub payload shapes within minutes -- before spending your time budget.
//
// Deliberately minimal: it does NOT normalize, project, or render a Gantt. It posts a
// GraphQL read to each endpoint and pretty-prints exactly what the wire returns.
// Building the Gantt on top of these raw payloads is your job.

import { useEffect, useState } from "react";

// An example `issues` GraphQL query, trimmed to the field set fake-Linear serves.
// Replace or extend it as you build.
const ISSUES_QUERY = `
  query ExampleIssues {
    issues {
      nodes {
        id
        identifier
        title
        url
        startedAt
        dueDate
        state { name }
        assignee { id name displayName email }
        project { id name }
        projectMilestone { id name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// The PR discovery query fake-GitHub serves (one repo + state per call). You normalize
// the nested reviews and review-request timeline yourself. Example: orbital/voyager's
// OPEN pull requests.
const PULL_REQUESTS_QUERY = `
  query ExamplePullRequests($owner: String!, $name: String!, $state: PullRequestState!) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: [$state]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title state createdAt mergedAt closedAt updatedAt headRefName baseRefName url
          author { login }
          commits(first: 1) { nodes { commit { committedDate authoredDate } } }
          reviews(first: 100) { nodes { author { login } state submittedAt } }
          timelineItems(first: 100, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
            nodes {
              __typename
              ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } ... on Bot { login } } }
              ... on ReviewRequestRemovedEvent { createdAt requestedReviewer { ... on User { login } ... on Bot { login } } }
            }
          }
        }
      }
    }
  }
`;

async function postGraphql(
  endpoint: string,
  label: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`${label} responded ${res.status}`);
  return res.json();
}

export default function FakeExamplePage() {
  const [linear, setLinear] = useState<unknown>(null);
  const [github, setGithub] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      postGraphql("/api/fake/linear", "fake-Linear", ISSUES_QUERY).then(setLinear),
      postGraphql("/api/fake/github", "fake-GitHub", PULL_REQUESTS_QUERY, {
        owner: "orbital",
        name: "voyager",
        state: "OPEN",
      }).then(setGithub),
    ]).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const block = (testid: string, payload: unknown) =>
    payload === null ? (
      <p>Loading...</p>
    ) : (
      <pre
        data-testid={testid}
        style={{ background: "#f5f5f5", padding: "1rem", overflowX: "auto", borderRadius: 6 }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    );

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", lineHeight: 1.5 }}>
      <p>Standup Gantt takehome. Build your Gantt here. Raw Fake source payloads below.</p>
      {error ? (
        <pre style={{ color: "crimson" }}>Error: {error}</pre>
      ) : (
        <>
          <p>Raw fake-Linear payload (issues):</p>
          {block("fake-linear-payload", linear)}
          <p>Raw fake-GitHub payload (orbital/voyager open pull requests):</p>
          {block("fake-github-payload", github)}
        </>
      )}
    </main>
  );
}
