// fake-GitHub: the half of the Fake source that impersonates GitHub's GraphQL API in
// GitHub's own wire shape (see README). A single GraphQL POST endpoint, like the
// real `https://api.github.com/graphql`, so you point a normal GraphQL client at it and
// write the review normalization yourself (pairing requests to submissions, dropping
// bot and outside-contributor reviews, resolving each PR to its Linear issue).
//
// fake-GitHub is READ-ONLY by design: it answers the per-repo PR discovery query and
// rejects every mutation. That behavior lives in lib/fake-source/github.ts; this route
// is a thin adapter that hands the parsed GraphQL body there and JSON-encodes the
// result.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  executeFakeGithubGraphql,
  type FakeGithubGraphQLRequest,
} from "@/lib/fake-source/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as FakeGithubGraphQLRequest;
  // Dates are computed relative to `now` at request time, so reviews always land
  // populated around today regardless of when you run it.
  return NextResponse.json(executeFakeGithubGraphql(body, new Date()));
}
