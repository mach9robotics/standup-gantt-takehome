// fake-Linear: the half of the Fake source that impersonates Linear in Linear's own
// GraphQL wire shape (see README). It is a single GraphQL POST endpoint, like the
// real `https://api.linear.app/graphql`, so you point a normal GraphQL client at it and
// write the normalization yourself.
//
// It is WRITABLE the way real Linear is -- create / set-title / set-due-date / reassign
// / set-state / remove against an in-memory store seeded from the dataset -- and
// ENFORCES the source constraint that Linear has no writable issue start date. That
// behavior lives in lib/fake-source/store.ts; this route is a thin
// adapter that hands the parsed GraphQL body to the shared singleton store and
// JSON-encodes the result, so a write is reflected on the next read. There is
// deliberately no app-state endpoint for lanes or planned starts.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  executeFakeLinearGraphql,
  type FakeLinearGraphQLRequest,
  getFakeLinearStore,
} from "@/lib/fake-source/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as FakeLinearGraphQLRequest;
  return NextResponse.json(executeFakeLinearGraphql(getFakeLinearStore(), body));
}
