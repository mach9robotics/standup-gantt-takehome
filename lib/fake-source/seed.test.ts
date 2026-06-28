// Seam test for the seed dataset: assert the raw payload shape and the
// now-relative dating, not internal structure. "Given this `now`, the seed returns
// raw Linear issue nodes with these properties."

import {
  BOT_REVIEWER_LOGIN,
  FAKE_GITHUB_REPOS,
  OUTSIDE_AUTHOR_LOGIN,
  seedGithubPullRequests,
  seedGithubPullRequestsPage,
  seedLinearIssueNodes,
  seedLinearIssuesPage,
  TEAM,
} from "./seed";

const NOW = new Date("2026-06-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("seedLinearIssueNodes", () => {
  it("returns raw Linear-GraphQL-shaped issue nodes (nested state/assignee/project)", () => {
    const nodes = seedLinearIssueNodes(NOW);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    for (const n of nodes) {
      expect(typeof n.id).toBe("string");
      expect(typeof n.identifier).toBe("string");
      expect(typeof n.title).toBe("string");
      expect(typeof n.url).toBe("string");
      // Wire shape: state/assignee/project are nested objects, not flattened fields.
      if (n.state) expect(typeof n.state.name).toBe("string");
      if (n.assignee) {
        expect(typeof n.assignee.email).toBe("string");
        expect(typeof n.assignee.name).toBe("string");
        expect(typeof n.assignee.displayName).toBe("string");
      }
      if (n.project) expect(typeof n.project.name).toBe("string");
    }
  });

  it("covers the full issue edge-case set the projection must handle", () => {
    const nodes = seedLinearIssueNodes(NOW);
    const has = (pred: (n: (typeof nodes)[number]) => boolean) => nodes.some(pred);

    // active, started, with a due date
    expect(has((n) => n.startedAt !== null && n.dueDate !== null)).toBe(true);
    // planned but not started: no startedAt, due date set
    expect(has((n) => n.startedAt === null && n.dueDate !== null)).toBe(true);
    // open-ended: started, no due date
    expect(has((n) => n.startedAt !== null && n.dueDate === null)).toBe(true);
    // no-span: neither start nor due (must be omittable)
    expect(has((n) => n.startedAt === null && n.dueDate === null)).toBe(true);
    // clipped-left: started well before the range (> 2 weeks ago)
    expect(
      has((n) => n.startedAt !== null && new Date(n.startedAt).getTime() < NOW.getTime() - 14 * DAY_MS)
    ).toBe(true);
    // completed/deployed but still overlapping today (due on/before now, deploy state)
    expect(
      has(
        (n) =>
          n.dueDate !== null &&
          new Date(`${n.dueDate}T00:00:00Z`).getTime() <= NOW.getTime() &&
          /^On /.test(n.state?.name ?? "")
      )
    ).toBe(true);
    // cancelled
    expect(has((n) => n.state?.name === "Canceled")).toBe(true);
    // truly done
    expect(has((n) => n.state?.name === "Done")).toBe(true);
  });

  it("includes every automation-owned state in the seed dataset", () => {
    const states = new Set(seedLinearIssueNodes(NOW).map((n) => n.state?.name));
    for (const owned of ["In Progress", "In Review", "On Develop", "On Staging", "On Prod"]) {
      expect(states.has(owned)).toBe(true);
    }
  });

  it("spreads work across a team large enough that identity resolution is real work", () => {
    const emails = new Set(
      seedLinearIssueNodes(NOW)
        .map((n) => n.assignee?.email)
        .filter((e): e is string => Boolean(e))
    );
    expect(emails.size).toBeGreaterThanOrEqual(5);
  });

  it("includes richer future work and very short issues", () => {
    const nodes = seedLinearIssueNodes(NOW);
    const dueOffset = (n: (typeof nodes)[number]) =>
      n.dueDate ? (new Date(`${n.dueDate}T00:00:00Z`).getTime() - NOW.getTime()) / DAY_MS : null;

    const futureTasks = nodes.filter((n) => n.startedAt === null && (dueOffset(n) ?? 0) >= 14);
    expect(futureTasks.length).toBeGreaterThanOrEqual(3);

    const sameDayTasks = nodes.filter((n) => {
      if (!n.startedAt || !n.dueDate) return false;
      return new Date(n.startedAt).toISOString().slice(0, 10) === n.dueDate;
    });
    expect(sameDayTasks.length).toBeGreaterThanOrEqual(4);
  });

  it("includes unassigned and overdue active work", () => {
    const nodes = seedLinearIssueNodes(NOW);
    expect(nodes.filter((n) => n.assignee === null).map((n) => n.identifier).sort()).toEqual([
      "ORB-125",
      "ORB-128",
    ]);

    const overdueActive = nodes.filter(
      (n) =>
        n.startedAt !== null &&
        n.dueDate !== null &&
        new Date(`${n.dueDate}T00:00:00Z`).getTime() < NOW.getTime() &&
        ["In Progress", "In Review"].includes(n.state?.name ?? "")
    );
    expect(overdueActive.map((n) => n.identifier)).toEqual(expect.arrayContaining(["ORB-126", "ORB-127"]));
  });

  it("does not place completed work after the current instant", () => {
    const completed = seedLinearIssueNodes(NOW).filter((n) =>
      ["Done", "Canceled"].includes(n.state?.name ?? "")
    );
    for (const n of completed) {
      if (n.startedAt) expect(new Date(n.startedAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("keeps issue starts realistic instead of batch-started exactly at now", () => {
    const exactNowStarts = seedLinearIssueNodes(NOW).filter(
      (n) => n.startedAt !== null && new Date(n.startedAt).getTime() === NOW.getTime()
    );
    expect(exactNowStarts).toHaveLength(0);
  });

  it("keeps the team resolvable login -> email -> name, with non-trivial logins", () => {
    for (const member of Object.values(TEAM)) {
      expect(member.email).toMatch(/@orbital\.dev$/);
      expect(member.name.length).toBeGreaterThan(0);
      expect(member.githubLogin.length).toBeGreaterThan(0);
    }
    // Every issue assignee resolves to a roster member by email (the join key).
    const rosterEmails = new Set(Object.values(TEAM).map((m) => m.email));
    for (const n of seedLinearIssueNodes(NOW)) {
      if (n.assignee) expect(rosterEmails.has(n.assignee.email)).toBe(true);
    }
  });

  it("dates every node relative to the supplied `now`, not the real clock", () => {
    const nodes = seedLinearIssueNodes(NOW);
    for (const n of nodes) {
      if (n.startedAt !== null) {
        const delta = Math.abs(new Date(n.startedAt).getTime() - NOW.getTime());
        expect(delta).toBeLessThan(60 * 24 * 60 * 60 * 1000); // within ~2 months of `now`
      }
      if (n.dueDate !== null) {
        expect(n.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Linear timeless-date shape
      }
    }
  });

  it("is deterministic for a fixed `now` and shifts with `now` (pure)", () => {
    const a = seedLinearIssueNodes(NOW);
    const b = seedLinearIssueNodes(NOW);
    expect(b).toEqual(a);

    const later = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    const shifted = seedLinearIssueNodes(later);
    const dated = a.find((n) => n.startedAt !== null)!;
    const shiftedDated = shifted.find((n) => n.id === dated.id)!;
    expect(shiftedDated.startedAt).not.toEqual(dated.startedAt);
  });
});

describe("seedLinearIssuesPage", () => {
  it("wraps the nodes in a Linear `issues` connection page", () => {
    const page = seedLinearIssuesPage(NOW);
    expect(page.nodes).toEqual(seedLinearIssueNodes(NOW));
    expect(page.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
});

describe("seedGithubPullRequests", () => {
  const allNodes = () => seedGithubPullRequests(NOW).map((x) => x.node);
  const byNumber = (n: number) => allNodes().find((p) => p.number === n)!;

  it("returns raw GitHub-GraphQL-shaped PR nodes with nested reviews and timelineItems", () => {
    const tagged = seedGithubPullRequests(NOW);
    expect(tagged.length).toBeGreaterThanOrEqual(2);
    for (const { repo, node } of tagged) {
      // tagged with a repo drawn from the two fictional repos
      expect(FAKE_GITHUB_REPOS.some((r) => r.owner === repo.owner && r.name === repo.name)).toBe(true);
      expect(typeof node.number).toBe("number");
      expect(typeof node.title).toBe("string");
      expect(["OPEN", "MERGED", "CLOSED"]).toContain(node.state);
      expect(typeof node.headRefName).toBe("string");
      expect(typeof node.baseRefName).toBe("string");
      expect(node.url).toContain(`/${repo.owner}/${repo.name}/pull/${node.number}`);
      // Wire shape: reviews/timelineItems are nested connections, not flattened.
      expect(Array.isArray(node.reviews.nodes)).toBe(true);
      expect(Array.isArray(node.timelineItems.nodes)).toBe(true);
      expect(Array.isArray(node.commits.nodes)).toBe(true);
      for (const rv of node.reviews.nodes) {
        expect(typeof rv.author?.login).toBe("string");
        expect(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]).toContain(rv.state);
      }
      for (const tl of node.timelineItems.nodes) {
        expect(["ReviewRequestedEvent", "ReviewRequestRemovedEvent"]).toContain(tl.__typename);
        expect(typeof tl.requestedReviewer?.login).toBe("string");
      }
    }
  });

  it("seeds every review case, each individually identifiable", () => {
    // PENDING request: requested in the timeline, nothing submitted.
    const pending = byNumber(501);
    expect(pending.reviews.nodes).toHaveLength(0);
    expect(pending.timelineItems.nodes.some((t) => t.__typename === "ReviewRequestedEvent")).toBe(true);

    // COMPLETED: a request paired with a submission.
    const completed = byNumber(502);
    expect(completed.reviews.nodes.some((r) => r.submittedAt !== null && r.state !== "PENDING")).toBe(true);
    expect(completed.timelineItems.nodes.some((t) => t.__typename === "ReviewRequestedEvent")).toBe(true);

    // MOOTED: PR merged before any review was submitted.
    const mooted = byNumber(505);
    expect(mooted.state).toBe("MERGED");
    expect(mooted.mergedAt).not.toBeNull();
    expect(mooted.reviews.nodes).toHaveLength(0);
    expect(mooted.timelineItems.nodes.some((t) => t.__typename === "ReviewRequestedEvent")).toBe(true);

    // BOT reviewer present and NOT in the team roster.
    const bot = byNumber(506);
    expect(bot.reviews.nodes.some((r) => r.author?.login === BOT_REVIEWER_LOGIN)).toBe(true);

    // Team reviewer on an outside contributor's PR.
    const outside = byNumber(504);
    expect(outside.author?.login).toBe(OUTSIDE_AUTHOR_LOGIN);
    const teamLogins = new Set(Object.values(TEAM).map((m) => m.githubLogin));
    expect(
      outside.timelineItems.nodes.some((t) => teamLogins.has(t.requestedReviewer?.login ?? ""))
    ).toBe(true);

    // Busy reviewer: Priya has multiple active review obligations across repos.
    const priyaRequests = allNodes().flatMap((n) =>
      n.timelineItems.nodes
        .filter((t) => t.__typename === "ReviewRequestedEvent")
        .filter((t) => t.requestedReviewer?.login === TEAM.priya.githubLogin)
        .map(() => n.number)
    );
    expect(new Set(priyaRequests).size).toBeGreaterThanOrEqual(3);
  });

  it("includes denser review queues and same-day reviewed PRs", () => {
    const nodes = allNodes();
    const activePendingReviews = nodes.flatMap((n) =>
      n.timelineItems.nodes
        .filter((t) => t.__typename === "ReviewRequestedEvent")
        .filter((t) => n.state === "OPEN")
        .filter((t) => !n.reviews.nodes.some((r) => r.author?.login === t.requestedReviewer?.login))
        .map((t) => `${n.number}:${t.requestedReviewer?.login}`)
    );
    expect(activePendingReviews.length).toBeGreaterThanOrEqual(8);

    const sameDayReviewed = nodes.filter((n) => {
      if (n.reviews.nodes.length === 0) return false;
      const createdDay = new Date(n.createdAt).toISOString().slice(0, 10);
      return n.reviews.nodes.some((r) => r.submittedAt?.slice(0, 10) === createdDay);
    });
    expect(sameDayReviewed.length).toBeGreaterThanOrEqual(5);
  });

  it("includes mixed-reviewer, orphan, stale, and churn-rich PRs", () => {
    const mixed = byNumber(528);
    expect(mixed.reviews.nodes.map((r) => r.state)).toEqual(["APPROVED", "CHANGES_REQUESTED"]);
    expect(mixed.timelineItems.nodes.map((t) => t.requestedReviewer?.login)).toEqual(
      expect.arrayContaining([TEAM.dana.githubLogin, TEAM.ingrid.githubLogin, TEAM.theo.githubLogin])
    );

    // No issue key anywhere: these should normalize as orphan PRs.
    for (const n of [532, 535, 539]) {
      const node = byNumber(n);
      expect(`${node.headRefName} ${node.title}`).not.toMatch(/[a-z]+-\d+/i);
    }

    const stale = byNumber(531);
    expect(new Date(stale.timelineItems.nodes[0].createdAt).getTime()).toBeLessThan(
      NOW.getTime() - 7 * DAY_MS
    );

    const churn = byNumber(530);
    expect(churn.timelineItems.nodes.filter((t) => t.__typename === "ReviewRequestedEvent")).toHaveLength(3);
    expect(churn.timelineItems.nodes.filter((t) => t.__typename === "ReviewRequestRemovedEvent")).toHaveLength(1);

    // Multiple PRs can belong to the same issue without being a stack.
    const orb119Prs = allNodes().filter((n) => /orb-119/i.test(`${n.headRefName} ${n.title}`));
    expect(orb119Prs.map((n) => n.number).sort((a, b) => a - b)).toEqual([511, 528, 529]);
  });

  it("does not place merged PR events after the current instant", () => {
    const merged = allNodes().filter((n) => n.state === "MERGED");
    for (const n of merged) {
      expect(new Date(n.createdAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(new Date(n.mergedAt!).getTime()).toBeLessThanOrEqual(NOW.getTime());
      for (const r of n.reviews.nodes) {
        if (r.submittedAt) expect(new Date(r.submittedAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
      }
    }
  });

  it("keeps same-day PRs realistic instead of batch-created exactly at now", () => {
    const exactNowCreates = allNodes().filter((n) => new Date(n.createdAt).getTime() === NOW.getTime());
    expect(exactNowCreates.length).toBeLessThanOrEqual(2);
  });

  it("seeds the normalization traps (re-request, branch-vs-title, stacked chain)", () => {
    // RE-REQUESTED: requested -> removed -> re-requested, with a stale submission.
    const reReq = byNumber(507);
    const events = reReq.timelineItems.nodes;
    expect(events.filter((t) => t.__typename === "ReviewRequestedEvent")).toHaveLength(2);
    expect(events.filter((t) => t.__typename === "ReviewRequestRemovedEvent")).toHaveLength(1);
    // The single submitted review predates the LAST re-request (so naive pairing fails).
    const lastRequest = events
      .filter((t) => t.__typename === "ReviewRequestedEvent")
      .map((t) => new Date(t.createdAt).getTime())
      .sort((a, b) => a - b)
      .at(-1)!;
    const submission = new Date(reReq.reviews.nodes[0].submittedAt!).getTime();
    expect(submission).toBeLessThan(lastRequest);

    // BRANCH-vs-TITLE: #502 carries the identifier in the branch; #503 only in the title.
    expect(byNumber(502).headRefName).toMatch(/orb-101/i);
    expect(byNumber(503).headRefName).not.toMatch(/[a-z]+-\d+/i);
    expect(byNumber(503).title).toMatch(/ORB-104/);

    // STACKED chain: #509's base is #508's head branch.
    expect(byNumber(509).baseRefName).toBe(byNumber(508).headRefName);

    // LONGSTANDING issue + PR: ORB-106 has both a clipped-left Linear span and an old open PR.
    const longstandingIssue = seedLinearIssueNodes(NOW).find((n) => n.identifier === "ORB-106")!;
    expect(new Date(longstandingIssue.startedAt!).getTime()).toBeLessThan(
      NOW.getTime() - 14 * DAY_MS
    );
    expect(byNumber(508).headRefName).toMatch(/orb-106/i);
    expect(new Date(byNumber(508).createdAt).getTime()).toBeLessThan(NOW.getTime() - 14 * DAY_MS);
  });

  it("keeps reviewer/author logins resolvable to the team roster (login -> email -> name)", () => {
    const teamLogins = new Set(Object.values(TEAM).map((m) => m.githubLogin));
    const outsiders = new Set([BOT_REVIEWER_LOGIN, OUTSIDE_AUTHOR_LOGIN]);
    for (const node of allNodes()) {
      const logins = [
        node.author?.login,
        ...node.reviews.nodes.map((r) => r.author?.login),
        ...node.timelineItems.nodes.map((t) => t.requestedReviewer?.login),
      ].filter((l): l is string => Boolean(l));
      for (const login of logins) {
        // Every login is either a known teammate or a deliberately-unresolvable outsider.
        expect(teamLogins.has(login) || outsiders.has(login)).toBe(true);
      }
    }
    // The roster IS actually exercised (not just outsiders everywhere).
    const reviewerLogins = new Set(
      allNodes().flatMap((n) => n.timelineItems.nodes.map((t) => t.requestedReviewer?.login))
    );
    expect([...teamLogins].some((l) => reviewerLogins.has(l))).toBe(true);
  });

  it("dates PRs and reviews relative to the supplied `now`, and is deterministic (pure)", () => {
    const a = seedGithubPullRequests(NOW);
    const b = seedGithubPullRequests(NOW);
    expect(b).toEqual(a);
    for (const { node } of a) {
      expect(Math.abs(new Date(node.createdAt).getTime() - NOW.getTime())).toBeLessThan(
        60 * DAY_MS
      );
    }
    const later = new Date(NOW.getTime() + 7 * DAY_MS);
    expect(seedGithubPullRequests(later)[0].node.createdAt).not.toEqual(a[0].node.createdAt);
  });
});

describe("seedGithubPullRequestsPage", () => {
  it("filters to one repo + state and wraps as a GitHub pullRequests connection", () => {
    const open = seedGithubPullRequestsPage(NOW, "orbital", "voyager", "OPEN");
    expect(open.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(open.nodes.length).toBeGreaterThan(0);
    for (const n of open.nodes) {
      expect(n.state).toBe("OPEN");
      expect(n.url).toContain("/orbital/voyager/pull/");
    }
    // The MERGED mooted PR lives in horizon, so voyager/OPEN must not include it.
    expect(open.nodes.some((n) => n.number === 505)).toBe(false);

    const horizonMerged = seedGithubPullRequestsPage(NOW, "orbital", "horizon", "MERGED");
    expect(horizonMerged.nodes.map((n) => n.number)).toContain(505);
  });

  it("returns an empty page for an unknown repo", () => {
    const page = seedGithubPullRequestsPage(NOW, "orbital", "does-not-exist", "OPEN");
    expect(page.nodes).toHaveLength(0);
  });
});
