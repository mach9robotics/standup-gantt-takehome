// fake-Linear write surface + source-constraint enforcement.
//
// fake-Linear (app/api/fake/linear) is the half of the Fake source that impersonates
// Linear's GraphQL API. This module makes it WRITABLE the way real Linear is, against
// an in-memory mutable store seeded from the seed dataset, and ENFORCES the source
// constraints that are part of the spec (see README):
//
//   - Accepts the writes Linear really allows: create, set title, set due date,
//     reassign, set workflow state, and remove. A write is reflected on the next read
//     (the store is the source of truth once touched).
//   - REJECTS a writable issue START date. Linear has none: `startedAt` is auto-
//     stamped when an issue first enters a started state, and a *planned* start is
//     app-owned (you place it in your own app state). A write that tries to set a start
//     fails loudly rather than being silently dropped.
//
// HTTP-free on purpose: the route (app/api/fake/linear/route.ts) is a thin adapter
// that hands the parsed GraphQL body here and JSON-encodes the result, so this seam is
// unit-testable without Next (jest's testMatch is lib/ only). There is deliberately NO
// app-state endpoint here for lanes or planned starts: that app-owned state is yours to
// place.

import {
  DEFAULT_CREATE_STATE,
  findSeedUser,
  issueUrl,
  type RawLinearIssueNode,
  type RawLinearIssuesPage,
  type RawLinearUser,
  seedLinearIssueNodes,
} from "./seed";

/** A GraphQL request body as fake-Linear receives it (query string + variables). */
export interface FakeLinearGraphQLRequest {
  query?: string;
  variables?: Record<string, unknown>;
}

/** A GraphQL error in Linear's `{ errors: [...] }` wire shape. */
interface GraphQLError {
  message: string;
}

/** A GraphQL response: a `data` success or an `errors` failure, like real Linear. */
export type FakeLinearGraphQLResponse =
  | { data: Record<string, unknown> }
  | { errors: GraphQLError[] };

/**
 * Thrown by the store when a write violates a source constraint or targets something
 * that does not exist. The executor maps it to a GraphQL `errors` envelope, so you see
 * a faithful failure (not a misleading silent success). A distinct type so a genuine
 * bug still throws past the executor rather than being swallowed as a "constraint" error.
 */
export class FakeLinearWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeLinearWriteError";
  }
}

/** The fake-Linear mutable store: an in-memory issue set with the writes Linear allows. */
export interface FakeLinearStore {
  /** All issues as a single (unpaginated) Linear `issues` connection page. */
  listIssues(): RawLinearIssuesPage;
  /** Create an issue from an `IssueCreateInput`-shaped object; returns the new node. */
  createIssue(input: Record<string, unknown>): RawLinearIssueNode;
  /** Apply an `IssueUpdateInput`-shaped patch to an existing issue; returns the node. */
  updateIssue(id: string, input: Record<string, unknown>): RawLinearIssueNode;
  /** Remove an issue (Linear's `issueDelete`). Throws if it does not exist. */
  deleteIssue(id: string): void;
}

// Input keys that would set an issue start date. Linear's IssueCreate/UpdateInput has
// none of these (a planned start is app-owned), so any of them is a constraint
// violation that fails loudly rather than a silently ignored field.
const FORBIDDEN_START_KEYS = ["startedAt", "startDate", "startsAt", "start", "plannedStart"];

function assertNoStartWrite(input: Record<string, unknown>): void {
  const offending = Object.keys(input).find((key) =>
    FORBIDDEN_START_KEYS.some((forbidden) => forbidden.toLowerCase() === key.toLowerCase())
  );
  if (offending) {
    throw new FakeLinearWriteError(
      `fake-Linear: '${offending}' is not writable -- Linear has no writable issue start date. ` +
        "`startedAt` is auto-stamped when an issue first enters a started state, and a planned " +
        "start is app-owned (place it in your own app state, not Linear). Only `dueDate` writes through."
    );
  }
}

function resolveAssignee(value: unknown): RawLinearUser {
  const user = findSeedUser(String(value));
  if (!user) {
    throw new FakeLinearWriteError(
      `fake-Linear: no such assignee '${String(value)}'. Pass a teammate's Linear user id or email.`
    );
  }
  return user;
}

/**
 * Build a fresh fake-Linear store seeded from the Seed dataset at `now`. Each store is
 * independent (its own issue array + create counter), so tests get full isolation and
 * determinism by passing a fixed `now`; the running route shares one process-wide
 * singleton (getFakeLinearStore) so writes persist across requests.
 */
export function createFakeLinearStore(now: Date): FakeLinearStore {
  const issues: RawLinearIssueNode[] = seedLinearIssueNodes(now);
  // Created-issue ids/identifiers come from a counter (never Date.now/Math.random, so
  // the store stays deterministic) and sit above the seeded ORB-1xx range.
  let created = 0;

  return {
    listIssues(): RawLinearIssuesPage {
      return { nodes: issues, pageInfo: { hasNextPage: false, endCursor: null } };
    },

    createIssue(input: Record<string, unknown>): RawLinearIssueNode {
      assertNoStartWrite(input);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) {
        throw new FakeLinearWriteError("fake-Linear: issueCreate requires a non-empty `title`.");
      }
      const stateName =
        typeof input.stateId === "string" && input.stateId.trim()
          ? input.stateId.trim()
          : DEFAULT_CREATE_STATE;
      const assignee = input.assigneeId != null ? resolveAssignee(input.assigneeId) : null;
      const dueDate = input.dueDate == null ? null : String(input.dueDate);

      created += 1;
      const num = 900 + created;
      const identifier = `ORB-${num}`;
      const node: RawLinearIssueNode = {
        id: `iss_orb${num}`,
        identifier,
        title,
        url: issueUrl(identifier),
        // A freshly created issue is not yet started: Linear leaves startedAt null
        // until it first enters a started state (which automation, not the app, drives).
        startedAt: null,
        dueDate,
        state: { name: stateName },
        assignee,
        project: null,
        projectMilestone: null,
      };
      issues.push(node);
      return node;
    },

    updateIssue(id: string, input: Record<string, unknown>): RawLinearIssueNode {
      assertNoStartWrite(input);
      const node = issues.find((issue) => issue.id === id);
      if (!node) {
        throw new FakeLinearWriteError(`fake-Linear: no such issue '${id}'.`);
      }
      // Only the fields actually present are touched (`"key" in input`), so set-due-date
      // with an explicit null clears it while an absent key leaves it alone.
      if ("title" in input) {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) {
          throw new FakeLinearWriteError("fake-Linear: `title` must be a non-empty string.");
        }
        node.title = title;
      }
      if ("dueDate" in input) {
        node.dueDate = input.dueDate == null ? null : String(input.dueDate);
      }
      if ("assigneeId" in input) {
        node.assignee = resolveAssignee(input.assigneeId);
      }
      if ("stateId" in input) {
        const state = typeof input.stateId === "string" ? input.stateId.trim() : "";
        if (!state) {
          throw new FakeLinearWriteError("fake-Linear: `stateId` must be a non-empty state name.");
        }
        node.state = { name: state };
      }
      return node;
    },

    deleteIssue(id: string): void {
      const index = issues.findIndex((issue) => issue.id === id);
      if (index < 0) {
        throw new FakeLinearWriteError(`fake-Linear: no such issue '${id}'.`);
      }
      issues.splice(index, 1);
    },
  };
}

function errorEnvelope(message: string): FakeLinearGraphQLResponse {
  return { errors: [{ message }] };
}

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Route a parsed GraphQL request against a store and return the response envelope.
 * This is the fake-Linear behavior seam: "given this query + variables, the Fake
 * source returns this payload (or this error)." fake-Linear identifies workflow states
 * by NAME (it mints no separate state ids, since the read wire exposes only
 * `state { name }`), so `IssueUpdateInput.stateId` / `IssueCreateInput.stateId` carry a
 * state name here; assignees resolve by Linear user id or email.
 *
 * Mutation ops are matched before the `issues` read (a mutation's `issue { ... }`
 * selection never matches `\bissues\b`). A constraint violation or a missing target
 * comes back as Linear's `{ errors: [...] }` envelope, like the real API.
 */
export function executeFakeLinearGraphql(
  store: FakeLinearStore,
  body: FakeLinearGraphQLRequest
): FakeLinearGraphQLResponse {
  const query = body.query ?? "";
  const variables = body.variables ?? {};

  try {
    if (/\bissueCreate\b/.test(query)) {
      const issue = store.createIssue(asInput(variables.input));
      return { data: { issueCreate: { success: true, issue } } };
    }
    if (/\bissueUpdate\b/.test(query)) {
      const id = typeof variables.id === "string" ? variables.id : "";
      if (!id) return errorEnvelope("fake-Linear: issueUpdate requires an `id` variable.");
      const issue = store.updateIssue(id, asInput(variables.input));
      return { data: { issueUpdate: { success: true, issue } } };
    }
    if (/\bissueDelete\b/.test(query)) {
      const id = typeof variables.id === "string" ? variables.id : "";
      if (!id) return errorEnvelope("fake-Linear: issueDelete requires an `id` variable.");
      store.deleteIssue(id);
      return { data: { issueDelete: { success: true } } };
    }
    if (/\bissues\b/.test(query)) {
      return { data: { issues: store.listIssues() } };
    }
    return errorEnvelope(
      "fake-Linear answers the `issues` read query and the issueCreate / issueUpdate / issueDelete " +
        "mutations Linear allows. Unknown operations are rejected."
    );
  } catch (err) {
    // Match by name, not `instanceof`: in Next dev, HMR can recompile this module so the
    // globalThis-cached store throws a `FakeLinearWriteError` from a different module
    // instance than the one this catch closes over, and `instanceof` would miss it
    // (escaping as an unhandled 500 instead of a faithful `errors` envelope).
    if (err instanceof Error && err.name === "FakeLinearWriteError") {
      return errorEnvelope(err.message);
    }
    throw err;
  }
}

// --- Process-wide singleton for the running route -------------------------------
// The write route and the read query must share ONE store across requests (and across
// the separate module instances Next's dev HMR can create), so a created/edited issue
// is reflected on the next read, using a globalThis singleton so it survives the
// separate module instances Next's dev HMR can create. Seeded lazily at first touch
// with `new Date()`, so the board lands populated around today; persists thereafter so
// writes stick.

const globalForStore = globalThis as unknown as { __fakeLinearStore?: FakeLinearStore };

export function getFakeLinearStore(): FakeLinearStore {
  return (
    globalForStore.__fakeLinearStore ??
    (globalForStore.__fakeLinearStore = createFakeLinearStore(new Date()))
  );
}
