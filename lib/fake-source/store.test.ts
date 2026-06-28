// fake-Linear write surface + source-constraint enforcement. Tests the behavior at the
// fake-Linear request seam: "given this query + variables, the Fake source returns this
// payload (or this error), and the write is reflected on the next read." No HTTP, no DB
// -- the route is a thin adapter over this seam (jest's testMatch is lib/ only), so
// exercising executeFakeLinearGraphql against a fresh store is the faithful
// endpoint-behavior test.

import {
  DEFAULT_CREATE_STATE,
  type RawLinearIssueNode,
  seedLinearIssueNodes,
  TEAM,
  AUTOMATION_OWNED_STATES,
} from "./seed";
import {
  createFakeLinearStore,
  executeFakeLinearGraphql,
  type FakeLinearGraphQLResponse,
  type FakeLinearStore,
} from "./store";

const NOW = new Date("2026-06-27T12:00:00.000Z");

// GraphQL operation strings shaped like the ones a client would send. The
// executor routes on the operation name in the query, so these just need to contain it.
const READ = "query StandupGanttIssues { issues { nodes { id } pageInfo { hasNextPage } } }";
const CREATE = "mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title state { name } dueDate startedAt assignee { email } } } }";
const UPDATE = "mutation Update($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id title dueDate state { name } assignee { email } } } }";
const DELETE = "mutation Delete($id: String!) { issueDelete(id: $id) { success } }";

function readIssues(store: FakeLinearStore): RawLinearIssueNode[] {
  const res = executeFakeLinearGraphql(store, { query: READ }) as {
    data: { issues: { nodes: RawLinearIssueNode[] } };
  };
  return res.data.issues.nodes;
}

function dataOf(res: FakeLinearGraphQLResponse): Record<string, unknown> {
  if (!("data" in res)) throw new Error(`expected data, got errors: ${JSON.stringify(res)}`);
  return res.data;
}

function errorOf(res: FakeLinearGraphQLResponse): string {
  if (!("errors" in res)) throw new Error(`expected errors, got data: ${JSON.stringify(res)}`);
  return res.errors[0]!.message;
}

describe("fake-Linear read", () => {
  it("returns the full seeded issue set wrapped in Linear's `issues` connection", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, { query: READ }) as {
      data: { issues: { nodes: RawLinearIssueNode[]; pageInfo: { hasNextPage: boolean } } };
    };
    expect(res.data.issues.nodes).toHaveLength(seedLinearIssueNodes(NOW).length);
    expect(res.data.issues.pageInfo.hasNextPage).toBe(false);
  });
});

describe("fake-Linear create", () => {
  it("creates an issue, returns it, and it appears on the next read", () => {
    const store = createFakeLinearStore(NOW);
    const before = readIssues(store).length;

    const res = executeFakeLinearGraphql(store, {
      query: CREATE,
      variables: {
        input: { title: "  New planning task  ", assigneeId: TEAM.priya.email, dueDate: "2026-07-10" },
      },
    });

    const created = (dataOf(res).issueCreate as { success: boolean; issue: RawLinearIssueNode });
    expect(created.success).toBe(true);
    expect(created.issue.title).toBe("New planning task"); // trimmed
    expect(created.issue.dueDate).toBe("2026-07-10");
    expect(created.issue.assignee?.email).toBe(TEAM.priya.email);
    // A freshly created issue is not started (startedAt is automation-stamped, not app-set).
    expect(created.issue.startedAt).toBeNull();
    // Defaults to a writable pre-start state.
    expect(created.issue.state?.name).toBe(DEFAULT_CREATE_STATE);

    const after = readIssues(store);
    expect(after).toHaveLength(before + 1);
    expect(after.find((i) => i.id === created.issue.id)?.title).toBe("New planning task");
  });

  it("resolves the assignee by Linear user id as well as by email", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, {
      query: CREATE,
      variables: { input: { title: "By id", assigneeId: TEAM.marcus.id } },
    });
    const created = dataOf(res).issueCreate as { issue: RawLinearIssueNode };
    expect(created.issue.assignee?.email).toBe(TEAM.marcus.email);
  });

  it("rejects a blank title", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, {
      query: CREATE,
      variables: { input: { title: "   " } },
    });
    expect(errorOf(res)).toMatch(/non-empty `title`/);
  });

  it("rejects an unknown assignee", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, {
      query: CREATE,
      variables: { input: { title: "x", assigneeId: "nobody@example.com" } },
    });
    expect(errorOf(res)).toMatch(/no such assignee/);
  });

  it("create accepts any workflow state", () => {
    const store = createFakeLinearStore(NOW);
    const before = readIssues(store).length;
    const res = executeFakeLinearGraphql(store, {
      query: CREATE,
      variables: { input: { title: "Ship it", stateId: "On Prod" } },
    });
    const created = (dataOf(res).issueCreate as { issue: RawLinearIssueNode }).issue;
    expect(created.state?.name).toBe("On Prod");
    expect(readIssues(store)).toHaveLength(before + 1);
  });
});

describe("fake-Linear updates (each reflected on the next read)", () => {
  it("set-title mutates the store", () => {
    const store = createFakeLinearStore(NOW);
    executeFakeLinearGraphql(store, {
      query: UPDATE,
      variables: { id: "iss_orb101", input: { title: "Renamed cache work" } },
    });
    expect(readIssues(store).find((i) => i.id === "iss_orb101")?.title).toBe("Renamed cache work");
  });

  it("set-due-date sets and clears the due date (null clears)", () => {
    const store = createFakeLinearStore(NOW);
    executeFakeLinearGraphql(store, {
      query: UPDATE,
      variables: { id: "iss_orb101", input: { dueDate: "2026-08-01" } },
    });
    expect(readIssues(store).find((i) => i.id === "iss_orb101")?.dueDate).toBe("2026-08-01");

    executeFakeLinearGraphql(store, {
      query: UPDATE,
      variables: { id: "iss_orb101", input: { dueDate: null } },
    });
    expect(readIssues(store).find((i) => i.id === "iss_orb101")?.dueDate).toBeNull();
  });

  it("reassign changes the assignee", () => {
    const store = createFakeLinearStore(NOW);
    executeFakeLinearGraphql(store, {
      query: UPDATE,
      variables: { id: "iss_orb101", input: { assigneeId: TEAM.sam.email } },
    });
    expect(readIssues(store).find((i) => i.id === "iss_orb101")?.assignee?.email).toBe(TEAM.sam.email);
  });

  it("set-state moves the issue to any workflow state", () => {
    const store = createFakeLinearStore(NOW);
    for (const state of [
      "Done",
      "Canceled",
      "Selected For Development",
      "Design Exploration",
      ...AUTOMATION_OWNED_STATES,
    ]) {
      const res = executeFakeLinearGraphql(store, {
        query: UPDATE,
        variables: { id: "iss_orb101", input: { stateId: state } },
      });
      expect(dataOf(res).issueUpdate).toBeDefined();
      expect(readIssues(store).find((i) => i.id === "iss_orb101")?.state?.name).toBe(state);
    }
  });

  it("rejects updating an unknown issue", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, {
      query: UPDATE,
      variables: { id: "iss_nope", input: { title: "x" } },
    });
    expect(errorOf(res)).toMatch(/no such issue/);
  });
});

describe("fake-Linear remove", () => {
  it("removes an issue so it is gone on the next read", () => {
    const store = createFakeLinearStore(NOW);
    expect(readIssues(store).some((i) => i.id === "iss_orb108")).toBe(true);
    const res = executeFakeLinearGraphql(store, {
      query: DELETE,
      variables: { id: "iss_orb108" },
    });
    expect((dataOf(res).issueDelete as { success: boolean }).success).toBe(true);
    expect(readIssues(store).some((i) => i.id === "iss_orb108")).toBe(false);
  });

  it("rejects removing an unknown issue", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, { query: DELETE, variables: { id: "iss_nope" } });
    expect(errorOf(res)).toMatch(/no such issue/);
  });
});

describe("source constraint: no writable start date", () => {
  it.each(["startedAt", "startDate", "start", "plannedStart"])(
    "rejects setting `%s` on create, and the store is unchanged",
    (key) => {
      const store = createFakeLinearStore(NOW);
      const before = readIssues(store).length;
      const res = executeFakeLinearGraphql(store, {
        query: CREATE,
        variables: { input: { title: "x", [key]: "2026-06-01" } },
      });
      expect(errorOf(res)).toMatch(/no writable issue start date/);
      expect(readIssues(store)).toHaveLength(before); // nothing created
    }
  );

  it.each(["startedAt", "startDate", "start", "plannedStart"])(
    "rejects setting `%s` on update, and the issue is unchanged",
    (key) => {
      const store = createFakeLinearStore(NOW);
      const original = readIssues(store).find((i) => i.id === "iss_orb102")!.startedAt;
      const res = executeFakeLinearGraphql(store, {
        query: UPDATE,
        variables: { id: "iss_orb102", input: { [key]: "2026-06-01" } },
      });
      expect(errorOf(res)).toMatch(/no writable issue start date/);
      expect(readIssues(store).find((i) => i.id === "iss_orb102")?.startedAt).toBe(original);
    }
  );
});

describe("fake-Linear unsupported operations", () => {
  it("rejects an unknown operation with a faithful GraphQL error", () => {
    const store = createFakeLinearStore(NOW);
    const res = executeFakeLinearGraphql(store, { query: "mutation { projectCreate { success } }" });
    expect(errorOf(res)).toMatch(/Unknown operations are rejected/);
  });
});

describe("store isolation", () => {
  it("each store is independent (a write to one does not leak to another)", () => {
    const a = createFakeLinearStore(NOW);
    const b = createFakeLinearStore(NOW);
    executeFakeLinearGraphql(a, { query: DELETE, variables: { id: "iss_orb101" } });
    expect(readIssues(a).some((i) => i.id === "iss_orb101")).toBe(false);
    expect(readIssues(b).some((i) => i.id === "iss_orb101")).toBe(true);
  });
});
