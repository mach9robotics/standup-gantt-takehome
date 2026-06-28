// Seed dataset: the Fake source's shared spine. A PURE module that produces raw
// Linear-GraphQL-shaped issue nodes -- the provider's own wire shape, not a normalized
// record. You write the normalization yourself, so the Fake source hands back exactly
// what Linear's GraphQL API would.
//
// Constraints:
//   - No HTTP, no Next, no framework imports, so it can back both the route and the
//     unit tests with no transport dependency.
//   - Fictional people, projects, and repos only. No real-world identifiers anywhere.
//   - Dates are computed relative to a `now` passed IN by the caller (never read from
//     the clock here, so the module stays pure and deterministic in tests). The route
//     passes `new Date()`; tests pass a fixed instant. Either way the board lands
//     populated around "today".
//
// The dataset is the full issue edge-case set (every status, planned-vs-actual start,
// open-ended, clipped-left, no-span, completed-overlapping, cancelled, automation-owned
// states) across a fictional team that stays resolvable across fake-Linear and
// fake-GitHub (login -> email -> name), so identity resolution is real normalization
// work.

/**
 * A Linear user as it appears nested on an issue node in Linear's GraphQL wire
 * shape. `email` is the join key you resolve against fake-GitHub logins;
 * `name`/`displayName` are carried so identity resolution is real work, not a given.
 */
export interface RawLinearUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
}

/** A named node (project / milestone) as Linear nests it on an issue. */
export interface RawLinearNamedNode {
  id: string;
  name: string;
}

/**
 * A raw Linear issue node, exactly as Linear's GraphQL `issues.nodes[]` returns it.
 * This is the wire shape -- you normalize it into your own record.
 */
export interface RawLinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  /** ISO timestamp auto-stamped when the issue first reached a started state, or null. */
  startedAt: string | null;
  /** Writable due date as Linear returns it: "YYYY-MM-DD" or null. */
  dueDate: string | null;
  state: { name: string } | null;
  assignee: RawLinearUser | null;
  project: RawLinearNamedNode | null;
  projectMilestone: RawLinearNamedNode | null;
}

/** Page-of-issues payload mirroring Linear's `issues` connection. */
export interface RawLinearIssuesPage {
  nodes: RawLinearIssueNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `now`-relative ISO timestamp (for startedAt). */
function isoAt(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString();
}

/** `now`-relative timeless date "YYYY-MM-DD" (for dueDate), in UTC. */
function isoDate(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

// --- Fictional cast --------------------------------------------------------------
// A team of six. All fictional -- no real people, domain, projects, or repos appear here.
//
// Identity resolution is deliberately non-trivial (see README): the GitHub `login` is
// NOT derivable from the Linear email local-part or displayName, so you have to join
// login -> email -> name through this shared roster rather than string-munging.
// fake-Linear hands back the Linear half (id/name/displayName/email); fake-GitHub hands
// back the `login`, and the email is the only stable join key.

/** A teammate's full cross-tool identity. The Linear wire shape carries only the
 *  Linear half; `githubLogin` is consumed by fake-GitHub. */
export interface TeamMember extends RawLinearUser {
  /** GitHub login as it appears on PR authors/reviewers. Not a Linear field. */
  githubLogin: string;
}

/** The single source of truth for the fictional team, keyed by a short handle. */
export const TEAM = {
  priya: {
    id: "usr_priya",
    name: "Priya Nadkarni",
    displayName: "priya",
    email: "priya@orbital.dev",
    githubLogin: "pnadkarni",
  },
  marcus: {
    id: "usr_marcus",
    name: "Marcus Webb",
    displayName: "marcus",
    email: "marcus@orbital.dev",
    githubLogin: "mwebb-dev",
  },
  dana: {
    id: "usr_dana",
    name: "Dana Cho",
    displayName: "dana",
    email: "dana@orbital.dev",
    githubLogin: "dcho",
  },
  theo: {
    id: "usr_theo",
    name: "Theo Ramos",
    displayName: "theo",
    email: "theo@orbital.dev",
    githubLogin: "theoramos",
  },
  ingrid: {
    id: "usr_ingrid",
    name: "Ingrid Olsen",
    displayName: "ingrid",
    email: "ingrid@orbital.dev",
    githubLogin: "iolsen",
  },
  sam: {
    id: "usr_sam",
    name: "Sam Okafor",
    displayName: "sam",
    email: "sam@orbital.dev",
    githubLogin: "sokafor",
  },
} satisfies Record<string, TeamMember>;

/** Strip the cross-tool extras to the Linear-only wire shape an issue node nests. */
function linearUser(member: TeamMember): RawLinearUser {
  return {
    id: member.id,
    name: member.name,
    displayName: member.displayName,
    email: member.email,
  };
}

const PEOPLE: Record<keyof typeof TEAM, RawLinearUser> = {
  priya: linearUser(TEAM.priya),
  marcus: linearUser(TEAM.marcus),
  dana: linearUser(TEAM.dana),
  theo: linearUser(TEAM.theo),
  ingrid: linearUser(TEAM.ingrid),
  sam: linearUser(TEAM.sam),
};

export function issueUrl(identifier: string): string {
  return `https://linear.app/orbital/issue/${identifier}`;
}

/**
 * Linear workflow states normally advanced by the workspace's GitHub automation.
 * The seed includes them so status mapping has to distinguish review/deploy progress
 * from manually planned work.
 */
export const AUTOMATION_OWNED_STATES = new Set<string>([
  "In Progress",
  "In Review",
  "On Develop",
  "On Staging",
  "On Prod",
]);

/** State a freshly created issue lands in: queued, pre-start (a writable state). */
export const DEFAULT_CREATE_STATE = "Selected For Development";

/**
 * Resolve a seeded teammate to the Linear-only wire shape an issue node nests, by
 * Linear user id (e.g. "usr_priya") OR email (the cross-tool join key). Returns null
 * if no teammate matches, so fake-Linear can reject a write to an unknown assignee.
 */
export function findSeedUser(idOrEmail: string): RawLinearUser | null {
  const member = Object.values(TEAM).find(
    (m) => m.id === idOrEmail || m.email === idOrEmail
  );
  return member ? linearUser(member) : null;
}

// Fictional projects.
const ATLAS = { id: "prj_atlas", name: "Atlas Export" };
const PATHFINDER = { id: "prj_pathfinder", name: "Pathfinder Sync" };
const BEACON = { id: "prj_beacon", name: "Beacon Telemetry" };
const CARTOGRAPHER = { id: "prj_cartographer", name: "Cartographer" };
const ALPHA = { id: "mst_alpha", name: "Alpha" };
const BETA = { id: "mst_beta", name: "Beta" };

/**
 * The seed issue set as raw Linear issue nodes, dated relative to `now`.
 *
 * The full edge-case set a correct Gantt projection must handle, spread across the
 * six-person team so the board reads like a real standup round-robin:
 *   - ORB-101: active, started, with a due date (a normal in-flight bar).
 *   - ORB-102: planned-but-not-started -- no `startedAt`, future due date (pre-start).
 *   - ORB-103: open-ended -- started, NO due date (runs to "today").
 *   - ORB-104: completed/deployed but still overlapping today (On Develop, due yesterday).
 *   - ORB-105: in review -- PR up (In Review, an automation-owned state).
 *   - ORB-106: clipped-left -- started weeks before the range, long-running.
 *   - ORB-107: no-span -- no start, no due date (must be omittable from the timeline).
 *   - ORB-108: cancelled (Canceled).
 *   - ORB-109: truly done and recent (Done).
 *   - ORB-110: deployed (On Staging, an automation-owned state).
 *   - ORB-111: started in a writable non-eng state (Design Exploration).
 *   - ORB-112: deployed and overlapping today (On Prod, an automation-owned state).
 *   - ORB-113..ORB-132: richer demo density -- future planned work, same-day
 *       micro-tasks, review-ready issues, tiny completed tasks, overdue work,
 *       unassigned issues, and deliberately imbalanced lanes.
 *
 * Automation-owned states present:
 * In Progress, In Review, On Develop, On Staging, On Prod.
 */
export function seedLinearIssueNodes(now: Date): RawLinearIssueNode[] {
  return [
    {
      id: "iss_orb101",
      identifier: "ORB-101",
      title: "Tile cache invalidation on layer edit",
      url: issueUrl("ORB-101"),
      startedAt: isoAt(now, -3.3),
      dueDate: isoDate(now, 4),
      state: { name: "In Progress" },
      assignee: PEOPLE.priya,
      project: ATLAS,
      projectMilestone: ALPHA,
    },
    {
      id: "iss_orb102",
      identifier: "ORB-102",
      title: "Pathfinder route diffing",
      url: issueUrl("ORB-102"),
      startedAt: null, // planned but not started
      dueDate: isoDate(now, 9),
      state: { name: "Selected For Development" },
      assignee: PEOPLE.marcus,
      project: PATHFINDER,
      projectMilestone: null,
    },
    {
      id: "iss_orb103",
      identifier: "ORB-103",
      title: "Snapping tolerance edge cases",
      url: issueUrl("ORB-103"),
      startedAt: isoAt(now, -2.4),
      dueDate: null, // open-ended: started, no due date
      state: { name: "In Progress" },
      assignee: PEOPLE.dana,
      project: null,
      projectMilestone: null,
    },
    {
      id: "iss_orb104",
      identifier: "ORB-104",
      title: "Export manifest schema v2",
      url: issueUrl("ORB-104"),
      startedAt: isoAt(now, -6.6),
      dueDate: isoDate(now, -1), // due yesterday, still overlapping today
      state: { name: "On Develop" },
      assignee: PEOPLE.priya,
      project: ATLAS,
      projectMilestone: null,
    },
    {
      id: "iss_orb105",
      identifier: "ORB-105",
      title: "Telemetry ingest backpressure",
      url: issueUrl("ORB-105"),
      startedAt: isoAt(now, -5.2),
      dueDate: isoDate(now, 2),
      state: { name: "In Review" }, // PR up (paired with a review in fake-GitHub)
      assignee: PEOPLE.theo,
      project: BEACON,
      projectMilestone: ALPHA,
    },
    {
      id: "iss_orb106",
      identifier: "ORB-106",
      title: "Projection coordinate-system migration",
      url: issueUrl("ORB-106"),
      startedAt: isoAt(now, -24), // started weeks ago: clipped at the range's left edge
      dueDate: isoDate(now, 6),
      state: { name: "In Progress" },
      assignee: PEOPLE.ingrid,
      project: CARTOGRAPHER,
      projectMilestone: null,
    },
    {
      id: "iss_orb107",
      identifier: "ORB-107",
      title: "Investigate flaky tile-fetch retries",
      url: issueUrl("ORB-107"),
      startedAt: null,
      dueDate: null, // no span at all: must be omittable from the timeline
      state: { name: "Backlog" },
      assignee: PEOPLE.sam,
      project: null,
      projectMilestone: null,
    },
    {
      id: "iss_orb108",
      identifier: "ORB-108",
      title: "Legacy route-diff fallback",
      url: issueUrl("ORB-108"),
      startedAt: isoAt(now, -3.7),
      dueDate: isoDate(now, 2),
      state: { name: "Canceled" }, // cancelled work
      assignee: PEOPLE.marcus,
      project: PATHFINDER,
      projectMilestone: null,
    },
    {
      id: "iss_orb109",
      identifier: "ORB-109",
      title: "Dashboard latency budget",
      url: issueUrl("ORB-109"),
      startedAt: isoAt(now, -9.3),
      dueDate: isoDate(now, -3),
      state: { name: "Done" }, // truly completed, recent
      assignee: PEOPLE.dana,
      project: BEACON,
      projectMilestone: null,
    },
    {
      id: "iss_orb110",
      identifier: "ORB-110",
      title: "Alert routing rules v2",
      url: issueUrl("ORB-110"),
      startedAt: isoAt(now, -4.4),
      dueDate: isoDate(now, 1),
      state: { name: "On Staging" }, // automation-owned deploy state
      assignee: PEOPLE.theo,
      project: BEACON,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb111",
      identifier: "ORB-111",
      title: "Basemap label-collision study",
      url: issueUrl("ORB-111"),
      startedAt: isoAt(now, -1.3),
      dueDate: isoDate(now, 7),
      state: { name: "Design Exploration" }, // started, writable non-eng state
      assignee: PEOPLE.ingrid,
      project: CARTOGRAPHER,
      projectMilestone: null,
    },
    {
      id: "iss_orb112",
      identifier: "ORB-112",
      title: "Export retry idempotency keys",
      url: issueUrl("ORB-112"),
      startedAt: isoAt(now, -7.1),
      dueDate: isoDate(now, -1), // shipped, still overlapping today
      state: { name: "On Prod" }, // automation-owned deploy state
      assignee: PEOPLE.sam,
      project: ATLAS,
      projectMilestone: null,
    },
    {
      id: "iss_orb113",
      identifier: "ORB-113",
      title: "Atlas export filename presets",
      url: issueUrl("ORB-113"),
      startedAt: null,
      dueDate: isoDate(now, 14),
      state: { name: "Selected For Development" },
      assignee: PEOPLE.priya,
      project: ATLAS,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb114",
      identifier: "ORB-114",
      title: "Pathfinder dry-run summary cards",
      url: issueUrl("ORB-114"),
      startedAt: null,
      dueDate: isoDate(now, 18),
      state: { name: "Todo" },
      assignee: PEOPLE.marcus,
      project: PATHFINDER,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb115",
      identifier: "ORB-115",
      title: "Copy fix for empty export drawer",
      url: issueUrl("ORB-115"),
      startedAt: isoAt(now, -1.2),
      dueDate: isoDate(now, -1),
      state: { name: "Done" },
      assignee: PEOPLE.dana,
      project: ATLAS,
      projectMilestone: null,
    },
    {
      id: "iss_orb116",
      identifier: "ORB-116",
      title: "One-pixel gridline alignment",
      url: issueUrl("ORB-116"),
      startedAt: isoAt(now, -0.15),
      dueDate: isoDate(now, 0),
      state: { name: "In Progress" },
      assignee: PEOPLE.theo,
      project: CARTOGRAPHER,
      projectMilestone: null,
    },
    {
      id: "iss_orb117",
      identifier: "ORB-117",
      title: "Regional datum QA pass",
      url: issueUrl("ORB-117"),
      startedAt: null,
      dueDate: isoDate(now, 24),
      state: { name: "Selected For Development" },
      assignee: PEOPLE.ingrid,
      project: CARTOGRAPHER,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb118",
      identifier: "ORB-118",
      title: "Suppress duplicate retry toast",
      url: issueUrl("ORB-118"),
      startedAt: isoAt(now, -2.2),
      dueDate: isoDate(now, -2),
      state: { name: "On Prod" },
      assignee: PEOPLE.sam,
      project: ATLAS,
      projectMilestone: null,
    },
    {
      id: "iss_orb119",
      identifier: "ORB-119",
      title: "Webhook retry visibility",
      url: issueUrl("ORB-119"),
      startedAt: isoAt(now, -1.6),
      dueDate: isoDate(now, 3),
      state: { name: "In Review" },
      assignee: PEOPLE.marcus,
      project: PATHFINDER,
      projectMilestone: null,
    },
    {
      id: "iss_orb120",
      identifier: "ORB-120",
      title: "Tile preview shimmer",
      url: issueUrl("ORB-120"),
      startedAt: isoAt(now, -0.8),
      dueDate: isoDate(now, 0),
      state: { name: "In Review" },
      assignee: PEOPLE.dana,
      project: ATLAS,
      projectMilestone: null,
    },
    {
      id: "iss_orb121",
      identifier: "ORB-121",
      title: "Scale bar label capitalization",
      url: issueUrl("ORB-121"),
      startedAt: isoAt(now, -1.1),
      dueDate: isoDate(now, -1),
      state: { name: "Done" },
      assignee: PEOPLE.priya,
      project: CARTOGRAPHER,
      projectMilestone: null,
    },
    {
      id: "iss_orb122",
      identifier: "ORB-122",
      title: "Standup lane overflow hint",
      url: issueUrl("ORB-122"),
      startedAt: isoAt(now, -0.08),
      dueDate: isoDate(now, 0),
      state: { name: "In Review" },
      assignee: PEOPLE.theo,
      project: BEACON,
      projectMilestone: null,
    },
    {
      id: "iss_orb123",
      identifier: "ORB-123",
      title: "Future audit log export",
      url: issueUrl("ORB-123"),
      startedAt: null,
      dueDate: isoDate(now, 31),
      state: { name: "Backlog" },
      assignee: PEOPLE.sam,
      project: BEACON,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb124",
      identifier: "ORB-124",
      title: "Legend spacing cleanup",
      url: issueUrl("ORB-124"),
      startedAt: isoAt(now, -1.4),
      dueDate: isoDate(now, -1),
      state: { name: "Done" },
      assignee: PEOPLE.ingrid,
      project: null,
      projectMilestone: null,
    },
    {
      id: "iss_orb125",
      identifier: "ORB-125",
      title: "Public export template review",
      url: issueUrl("ORB-125"),
      startedAt: isoAt(now, -4.2),
      dueDate: isoDate(now, 5),
      state: { name: "In Review" },
      assignee: null,
      project: ATLAS,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb126",
      identifier: "ORB-126",
      title: "Beacon webhook replay backfill",
      url: issueUrl("ORB-126"),
      startedAt: isoAt(now, -8.5),
      dueDate: isoDate(now, -3),
      state: { name: "In Progress" },
      assignee: PEOPLE.priya,
      project: BEACON,
      projectMilestone: null,
    },
    {
      id: "iss_orb127",
      identifier: "ORB-127",
      title: "Pathfinder billing boundary audit",
      url: issueUrl("ORB-127"),
      startedAt: isoAt(now, -5.5),
      dueDate: isoDate(now, -1),
      state: { name: "In Review" },
      assignee: PEOPLE.marcus,
      project: PATHFINDER,
      projectMilestone: null,
    },
    {
      id: "iss_orb128",
      identifier: "ORB-128",
      title: "Unassigned incident follow-up",
      url: issueUrl("ORB-128"),
      startedAt: null,
      dueDate: isoDate(now, 2),
      state: { name: "Triage" },
      assignee: null,
      project: BEACON,
      projectMilestone: null,
    },
    {
      id: "iss_orb129",
      identifier: "ORB-129",
      title: "Atlas CSV delimiter fallback",
      url: issueUrl("ORB-129"),
      startedAt: isoAt(now, -2.6),
      dueDate: isoDate(now, 1),
      state: { name: "In Progress" },
      assignee: PEOPLE.priya,
      project: ATLAS,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb130",
      identifier: "ORB-130",
      title: "Cartographer map pack publish",
      url: issueUrl("ORB-130"),
      startedAt: isoAt(now, -1.8),
      dueDate: isoDate(now, 6),
      state: { name: "In Review" },
      assignee: PEOPLE.priya,
      project: CARTOGRAPHER,
      projectMilestone: BETA,
    },
    {
      id: "iss_orb131",
      identifier: "ORB-131",
      title: "Review queue empty-state polish",
      url: issueUrl("ORB-131"),
      startedAt: isoAt(now, -0.25),
      dueDate: isoDate(now, 0),
      state: { name: "Done" },
      assignee: PEOPLE.dana,
      project: BEACON,
      projectMilestone: null,
    },
    {
      id: "iss_orb132",
      identifier: "ORB-132",
      title: "Datum picker tooltip copy",
      url: issueUrl("ORB-132"),
      startedAt: isoAt(now, -0.25),
      dueDate: isoDate(now, 0),
      state: { name: "Done" },
      assignee: PEOPLE.ingrid,
      project: CARTOGRAPHER,
      projectMilestone: null,
    },
  ];
}

/** The seed issues wrapped as a single (unpaginated) Linear `issues` connection page. */
export function seedLinearIssuesPage(now: Date): RawLinearIssuesPage {
  return {
    nodes: seedLinearIssueNodes(now),
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}

// --- fake-GitHub: raw PR / review / timeline payloads -----------------------------
// The GitHub half of the Fake source. PRs are served in GitHub's own GraphQL wire
// shape. You write the normalization: pairing review requests to submissions, dropping
// mooted reviews and ones from bots or outside contributors, and resolving each PR to
// its Linear issue.
//
// Identity resolution stays real work: PR authors/reviewers are GitHub `login`s, and
// the only stable join back to a person (and to fake-Linear's assignees) is
// login -> email -> name through TEAM. Two logins deliberately fall OUTSIDE the
// roster -- a bot reviewer and an outside-contributor author -- so your normalization
// must filter them rather than assume every login resolves.

/** A GitHub actor (PR author / reviewer / requested reviewer) as the wire nests it. */
export interface RawGithubActor {
  login: string;
}

/** A `reviews.nodes[]` entry in GitHub's wire shape (author is an Actor with `login`). */
export interface RawGithubReviewNode {
  author: RawGithubActor | null;
  /**
   * GitHub's review states. PENDING = drafted, not yet submitted. A *requested* review
   * awaiting a response is not a review node at all -- it lives in `timelineItems` as a
   * ReviewRequestedEvent with no paired submission (the seed models pending that way).
   */
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submittedAt: string | null;
}

/**
 * A `timelineItems.nodes[]` entry, filtered to the two review-request event types you
 * pair against submissions. `requestedReviewer` is a GitHub union; here it always
 * carries a `login` (User/Bot), matching the inline-fragment projection the discovery
 * query uses.
 */
export interface RawGithubTimelineNode {
  __typename: "ReviewRequestedEvent" | "ReviewRequestRemovedEvent";
  createdAt: string;
  requestedReviewer: RawGithubActor | null;
}

/** A `commits.nodes[]` entry -- the first commit, used to derive a PR's start edge. */
export interface RawGithubCommitNode {
  commit: { committedDate: string; authoredDate: string };
}

/**
 * A raw GitHub pull request node, as the discovery query's `pullRequests.nodes[]`
 * returns it. Includes `baseRefName` so a stacked-PR chain (a PR based on another PR's
 * branch) is resolvable from the wire.
 */
export interface RawGithubPullRequestNode {
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  /** Head branch. Linear's auto-branch convention embeds the issue identifier here. */
  headRefName: string;
  /** Base branch. For a stacked PR this is the parent PR's head branch, not "main". */
  baseRefName: string;
  url: string;
  author: RawGithubActor | null;
  commits: { nodes: RawGithubCommitNode[] };
  reviews: { nodes: RawGithubReviewNode[] };
  timelineItems: { nodes: RawGithubTimelineNode[] };
}

/** Page-of-PRs payload mirroring GitHub's `repository.pullRequests` connection. */
export interface RawGithubPullRequestsPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: RawGithubPullRequestNode[];
}

/** A fictional GitHub repository the Fake source serves PRs from. */
export interface FakeGithubRepo {
  owner: string;
  name: string;
}

/** The two fictional repos fake-GitHub answers for. */
export const FAKE_GITHUB_REPOS = [
  { owner: "orbital", name: "voyager" },
  { owner: "orbital", name: "horizon" },
] as const satisfies readonly FakeGithubRepo[];

/** A bot reviewer login -- NOT in TEAM, so normalization must drop it (bot filter). */
export const BOT_REVIEWER_LOGIN = "orbit-ci-bot";
/** An outside-contributor author login -- NOT in TEAM, so it resolves to no person. */
export const OUTSIDE_AUTHOR_LOGIN = "octo-intern";

function ghPrUrl(owner: string, name: string, number: number): string {
  return `https://github.com/${owner}/${name}/pull/${number}`;
}

/** Compact spec for a seeded PR; `buildPr` expands it to the raw wire node. Offsets
 *  are `now`-relative days, so the board lands populated around today on every run. */
interface PrSpec {
  number: number;
  title: string;
  state: RawGithubPullRequestNode["state"];
  /** Author login (null = ghost author); use a TEAM `githubLogin` or an outside login. */
  authorLogin: string | null;
  head: string;
  /** Base branch; default "main", or a parent PR's head for a stack child. */
  base?: string;
  created: number;
  merged?: number;
  closed?: number;
  updated?: number;
  /** First-commit offset (the PR's start edge). */
  commit: number;
  reviews?: Array<{ login: string; state: RawGithubReviewNode["state"]; offset: number }>;
  timeline?: Array<{ type: "requested" | "removed"; login: string; offset: number }>;
}

function buildPr(
  now: Date,
  owner: string,
  name: string,
  s: PrSpec
): { repo: FakeGithubRepo; node: RawGithubPullRequestNode } {
  return {
    repo: { owner, name },
    node: {
      number: s.number,
      title: s.title,
      state: s.state,
      createdAt: isoAt(now, s.created),
      mergedAt: s.merged != null ? isoAt(now, s.merged) : null,
      closedAt: s.closed != null ? isoAt(now, s.closed) : null,
      updatedAt: isoAt(now, s.updated ?? s.created),
      headRefName: s.head,
      baseRefName: s.base ?? "main",
      url: ghPrUrl(owner, name, s.number),
      author: s.authorLogin ? { login: s.authorLogin } : null,
      commits: {
        nodes: [{ commit: { committedDate: isoAt(now, s.commit), authoredDate: isoAt(now, s.commit) } }],
      },
      reviews: {
        nodes: (s.reviews ?? []).map((r) => ({
          author: { login: r.login },
          state: r.state,
          submittedAt: isoAt(now, r.offset),
        })),
      },
      timelineItems: {
        nodes: (s.timeline ?? []).map((t) => ({
          __typename: t.type === "requested" ? "ReviewRequestedEvent" : "ReviewRequestRemovedEvent",
          createdAt: isoAt(now, t.offset),
          requestedReviewer: { login: t.login },
        })),
      },
    },
  };
}

/**
 * The seed PR set as raw GitHub PR nodes, tagged with their repo, dated relative to
 * `now`. The shapes present in the data:
 *
 *   - #501 voyager: requested review, no submission yet.
 *   - #502 voyager: a review request paired with a submission; identifier in the branch.
 *   - #503 voyager: a review request paired with a submission (changes requested);
 *       identifier in the title only, branch has none.
 *   - #504 horizon: team reviewer (sokafor) on an outside contributor's PR (octo-intern).
 *   - #505 horizon: PR merged before any review was submitted.
 *   - #506 horizon: bot reviewer (orbit-ci-bot).
 *   - #507 voyager: requested -> removed -> re-requested, with a submission that
 *       predates the final re-request.
 *   - #508 / #509 voyager: #509's `baseRefName` is #508's head branch; both branches
 *       carry ORB-106, a longstanding issue with a longstanding PR. #508 has a
 *       submission, #509 does not.
 *   - #510 horizon: another pending review for Priya, creating a busy-reviewer pattern
 *       across repos.
 *   - #511..#514: more active review obligations spread across the team.
 *   - #515..#519: super-short reviewed PRs, mostly merged within a day.
 *   - #520..#527: heavier review queues so a couple of people have ~6 PRs awaiting them.
 *   - #528..#540: mixed multi-reviewer outcomes, parallel PRs on one issue, no-key
 *       orphans, stale review requests, review churn, and outside PRs mapped to issues.
 */
export function seedGithubPullRequests(
  now: Date
): Array<{ repo: FakeGithubRepo; node: RawGithubPullRequestNode }> {
  const { priya, marcus, dana, theo, ingrid, sam } = TEAM;
  return [
    // --- orbital/voyager ---
    buildPr(now, "orbital", "voyager", {
      number: 501,
      title: "Telemetry ingest backpressure",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/orb-105-telemetry-ingest`,
      created: -5,
      updated: -1,
      commit: -5,
      reviews: [], // pending: requested, nothing submitted yet
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -1 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 502,
      title: "Tile cache invalidation on layer edit",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/orb-101-tile-cache`, // resolves to ORB-101 by BRANCH
      created: -4,
      updated: -2,
      commit: -4,
      reviews: [{ login: dana.githubLogin, state: "APPROVED", offset: -2 }],
      timeline: [{ type: "requested", login: dana.githubLogin, offset: -4 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 503,
      title: "ORB-104: Export manifest schema v2", // identifier only in the TITLE
      state: "OPEN",
      authorLogin: marcus.githubLogin,
      head: `${marcus.githubLogin}/manifest-rework`, // NO identifier in the branch
      created: -6,
      updated: -3,
      commit: -6,
      reviews: [{ login: theo.githubLogin, state: "CHANGES_REQUESTED", offset: -3 }],
      timeline: [{ type: "requested", login: theo.githubLogin, offset: -6 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 507,
      title: "Snapping tolerance edge cases",
      state: "OPEN",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/orb-103-snapping`,
      created: -9,
      updated: -2,
      commit: -9,
      // An APPROVED submission timestamped before the final re-request below.
      reviews: [{ login: theo.githubLogin, state: "APPROVED", offset: -7 }],
      timeline: [
        { type: "requested", login: theo.githubLogin, offset: -8 },
        { type: "removed", login: theo.githubLogin, offset: -6 },
        { type: "requested", login: theo.githubLogin, offset: -2 }, // re-requested
      ],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 508,
      title: "Projection coordinate-system migration (1/2)",
      state: "OPEN",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/orb-106-projection-migration`, // stack base
      created: -18,
      updated: -4,
      commit: -20,
      reviews: [{ login: priya.githubLogin, state: "APPROVED", offset: -4 }],
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -15 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 509,
      title: "Projection coordinate-system migration (2/2)",
      state: "OPEN",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/orb-106-projection-migration-part-2`,
      base: `${ingrid.githubLogin}/orb-106-projection-migration`, // stacked on #508
      created: -3,
      updated: -1,
      commit: -3,
      reviews: [], // pending
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -1 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 511,
      title: "Webhook retry visibility",
      state: "OPEN",
      authorLogin: marcus.githubLogin,
      head: `${marcus.githubLogin}/orb-119-webhook-retry-visibility`,
      created: -1,
      updated: -0.05,
      commit: -1,
      reviews: [], // pending
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -0.05 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 512,
      title: "Tile preview shimmer",
      state: "OPEN",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/orb-120-tile-preview-shimmer`,
      created: -1,
      updated: -0.1,
      commit: -1,
      reviews: [], // pending
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.1 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 515,
      title: "ORB-115: Copy fix for empty export drawer",
      state: "MERGED",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/empty-drawer-copy`, // identifier only in the title
      created: -1,
      merged: -1,
      closed: -1,
      updated: -1,
      commit: -1,
      reviews: [
        { login: priya.githubLogin, state: "APPROVED", offset: -1 },
        { login: ingrid.githubLogin, state: "COMMENTED", offset: -1 },
      ],
      timeline: [
        { type: "requested", login: priya.githubLogin, offset: -1 },
        { type: "requested", login: ingrid.githubLogin, offset: -1 },
      ],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 516,
      title: "Scale bar label capitalization",
      state: "MERGED",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/orb-121-scale-bar-label`,
      created: -1,
      merged: -1,
      closed: -1,
      updated: -1,
      commit: -1,
      reviews: [
        { login: ingrid.githubLogin, state: "APPROVED", offset: -1 },
        { login: dana.githubLogin, state: "COMMENTED", offset: -1 },
      ],
      timeline: [
        { type: "requested", login: ingrid.githubLogin, offset: -1 },
        { type: "requested", login: dana.githubLogin, offset: -1 },
      ],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 520,
      title: "ORB-113: Atlas export filename presets",
      state: "OPEN",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/orb-113-export-filename-presets`,
      created: -0.15,
      updated: -0.05,
      commit: -0.15,
      reviews: [],
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -0.05 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 521,
      title: "ORB-114: Pathfinder dry-run summary cards",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/orb-114-dry-run-summary-cards`,
      created: -0.35,
      updated: -0.1,
      commit: -0.35,
      reviews: [],
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -0.1 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 522,
      title: "ORB-117: Regional datum QA pass",
      state: "OPEN",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/orb-117-regional-datum-qa`,
      created: -0.6,
      updated: -0.2,
      commit: -0.6,
      reviews: [],
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -0.2 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 528,
      title: "Webhook retry visibility API",
      state: "OPEN",
      authorLogin: marcus.githubLogin,
      head: `${marcus.githubLogin}/orb-119-webhook-retry-api`,
      created: -3,
      updated: -1,
      commit: -3,
      reviews: [
        { login: dana.githubLogin, state: "APPROVED", offset: -2 },
        { login: ingrid.githubLogin, state: "CHANGES_REQUESTED", offset: -1 },
      ],
      timeline: [
        { type: "requested", login: dana.githubLogin, offset: -3 },
        { type: "requested", login: ingrid.githubLogin, offset: -3 },
        { type: "requested", login: theo.githubLogin, offset: -1 },
      ],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 529,
      title: "Webhook retry visibility docs",
      state: "OPEN",
      authorLogin: marcus.githubLogin,
      head: `${marcus.githubLogin}/orb-119-webhook-retry-docs`,
      created: -2,
      updated: -1,
      commit: -2,
      reviews: [{ login: dana.githubLogin, state: "APPROVED", offset: -1 }],
      timeline: [{ type: "requested", login: dana.githubLogin, offset: -2 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 530,
      title: "Pathfinder billing boundary audit",
      state: "OPEN",
      authorLogin: marcus.githubLogin,
      head: `${marcus.githubLogin}/orb-127-billing-boundary-audit`,
      created: -8,
      updated: -1,
      commit: -8,
      reviews: [
        { login: theo.githubLogin, state: "CHANGES_REQUESTED", offset: -6 },
        { login: dana.githubLogin, state: "APPROVED", offset: -2 },
      ],
      timeline: [
        { type: "requested", login: theo.githubLogin, offset: -7 },
        { type: "removed", login: theo.githubLogin, offset: -5 },
        { type: "requested", login: theo.githubLogin, offset: -1 },
        { type: "requested", login: dana.githubLogin, offset: -3 },
      ],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 531,
      title: "Atlas CSV delimiter fallback",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/orb-129-csv-delimiter-fallback`,
      created: -10,
      updated: -8,
      commit: -10,
      reviews: [], // stale pending request: untouched for more than a week
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -9 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 532,
      title: "Workspace theme token cleanup",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/theme-token-cleanup`,
      created: -1,
      updated: -0.25,
      commit: -1,
      reviews: [],
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -0.25 }],
    }),
    buildPr(now, "orbital", "voyager", {
      number: 533,
      title: "ORB-125: Public export template review",
      state: "OPEN",
      authorLogin: OUTSIDE_AUTHOR_LOGIN,
      head: `${OUTSIDE_AUTHOR_LOGIN}/orb-125-public-export-template`,
      created: -1,
      updated: -0.15,
      commit: -1,
      reviews: [],
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.15 }],
    }),
    // --- orbital/horizon ---
    buildPr(now, "orbital", "horizon", {
      number: 504,
      title: "Docs site typo sweep",
      state: "OPEN",
      authorLogin: OUTSIDE_AUTHOR_LOGIN, // NOT in TEAM: outside contributor
      head: `${OUTSIDE_AUTHOR_LOGIN}/docs-typos`,
      created: -2,
      updated: -1,
      commit: -2,
      reviews: [], // pending
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -1 }], // team reviewer
    }),
    buildPr(now, "orbital", "horizon", {
      number: 505,
      title: "Dashboard latency budget",
      state: "MERGED",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/orb-109-dashboard-latency`,
      created: -8,
      merged: -2,
      closed: -2,
      updated: -2,
      commit: -8,
      reviews: [], // mooted: PR merged before the requested review ever happened
      timeline: [{ type: "requested", login: ingrid.githubLogin, offset: -6 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 506,
      title: "CI flake quarantine",
      state: "OPEN",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/ci-flake`,
      created: -3,
      updated: -1,
      commit: -3,
      reviews: [{ login: BOT_REVIEWER_LOGIN, state: "COMMENTED", offset: -1 }], // bot reviewer (not in TEAM)
      timeline: [{ type: "requested", login: BOT_REVIEWER_LOGIN, offset: -2 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 510,
      title: "ORB-110: Alert routing rules v2",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/orb-110-alert-routing`,
      created: -2,
      updated: -1,
      commit: -2,
      reviews: [], // pending: adds another active review obligation for Priya
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -1 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 513,
      title: "Standup lane overflow hint",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/orb-122-lane-overflow-hint`,
      created: -0.1,
      updated: -0.02,
      commit: -0.1,
      reviews: [], // pending
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -0.02 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 514,
      title: "Small README wording update",
      state: "OPEN",
      authorLogin: OUTSIDE_AUTHOR_LOGIN,
      head: `${OUTSIDE_AUTHOR_LOGIN}/small-readme-wording`,
      created: -0.8,
      updated: -0.4,
      commit: -0.8,
      reviews: [], // pending outside PR with a team reviewer
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.4 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 517,
      title: "Suppress duplicate retry toast",
      state: "MERGED",
      authorLogin: sam.githubLogin,
      head: `${sam.githubLogin}/orb-118-duplicate-retry-toast`,
      created: -2,
      merged: -2,
      closed: -2,
      updated: -2,
      commit: -2,
      reviews: [
        { login: theo.githubLogin, state: "APPROVED", offset: -2 },
        { login: dana.githubLogin, state: "APPROVED", offset: -2 },
        { login: ingrid.githubLogin, state: "COMMENTED", offset: -2 },
      ],
      timeline: [
        { type: "requested", login: theo.githubLogin, offset: -2 },
        { type: "requested", login: dana.githubLogin, offset: -2 },
        { type: "requested", login: ingrid.githubLogin, offset: -2 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 518,
      title: "Legend spacing cleanup",
      state: "MERGED",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/orb-124-legend-spacing`,
      created: -1,
      merged: -1,
      closed: -1,
      updated: -1,
      commit: -1,
      reviews: [
        { login: sam.githubLogin, state: "COMMENTED", offset: -1 },
        { login: dana.githubLogin, state: "APPROVED", offset: -1 },
      ],
      timeline: [
        { type: "requested", login: sam.githubLogin, offset: -1 },
        { type: "requested", login: dana.githubLogin, offset: -1 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 519,
      title: "One-pixel gridline alignment",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/orb-116-gridline-alignment`,
      created: -0.3,
      updated: -0.05,
      commit: -0.3,
      reviews: [
        { login: dana.githubLogin, state: "APPROVED", offset: -0.1 },
        { login: ingrid.githubLogin, state: "APPROVED", offset: -0.1 },
      ],
      timeline: [
        { type: "requested", login: dana.githubLogin, offset: -0.25 },
        { type: "requested", login: ingrid.githubLogin, offset: -0.25 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 523,
      title: "ORB-123: Future audit log export",
      state: "OPEN",
      authorLogin: sam.githubLogin,
      head: `${sam.githubLogin}/orb-123-future-audit-log-export`,
      created: -1,
      updated: -0.2,
      commit: -1,
      reviews: [],
      timeline: [{ type: "requested", login: priya.githubLogin, offset: -0.2 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 524,
      title: "Small changelog formatter",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/small-changelog-formatter`,
      created: -0.45,
      updated: -0.15,
      commit: -0.45,
      reviews: [],
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.15 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 525,
      title: "Export preview aria label",
      state: "OPEN",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/export-preview-aria-label`,
      created: -1.5,
      updated: -0.5,
      commit: -1.5,
      reviews: [],
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.5 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 526,
      title: "Beacon metric name cleanup",
      state: "OPEN",
      authorLogin: theo.githubLogin,
      head: `${theo.githubLogin}/beacon-metric-name-cleanup`,
      created: -2.5,
      updated: -0.25,
      commit: -2.5,
      reviews: [],
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -0.25 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 527,
      title: "Cartographer settings tooltip",
      state: "OPEN",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/cartographer-settings-tooltip`,
      created: -3.5,
      updated: -1,
      commit: -3.5,
      reviews: [],
      timeline: [{ type: "requested", login: marcus.githubLogin, offset: -1 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 534,
      title: "Cartographer map pack publish",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/orb-130-map-pack-publish`,
      created: -2,
      updated: -0.25,
      commit: -2,
      reviews: [
        { login: dana.githubLogin, state: "APPROVED", offset: -1 },
        { login: ingrid.githubLogin, state: "COMMENTED", offset: -1 },
      ],
      timeline: [
        { type: "requested", login: dana.githubLogin, offset: -2 },
        { type: "requested", login: ingrid.githubLogin, offset: -2 },
        { type: "requested", login: sam.githubLogin, offset: -0.25 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 535,
      title: "Dependency label sorting",
      state: "OPEN",
      authorLogin: sam.githubLogin,
      head: `${sam.githubLogin}/dependency-label-sorting`,
      created: -6,
      updated: -6,
      commit: -6,
      reviews: [], // no Linear key: intentionally orphaned
      timeline: [{ type: "requested", login: theo.githubLogin, offset: -6 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 536,
      title: "ORB-126: Beacon webhook replay backfill",
      state: "OPEN",
      authorLogin: priya.githubLogin,
      head: `${priya.githubLogin}/orb-126-webhook-replay-backfill`,
      created: -7,
      updated: -1,
      commit: -7,
      reviews: [
        { login: marcus.githubLogin, state: "CHANGES_REQUESTED", offset: -5 },
        { login: dana.githubLogin, state: "APPROVED", offset: -4 },
      ],
      timeline: [
        { type: "requested", login: marcus.githubLogin, offset: -6 },
        { type: "requested", login: dana.githubLogin, offset: -6 },
        { type: "requested", login: theo.githubLogin, offset: -2 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 537,
      title: "Review queue empty-state polish",
      state: "MERGED",
      authorLogin: dana.githubLogin,
      head: `${dana.githubLogin}/orb-131-review-queue-empty-state`,
      created: -0.25,
      merged: -0.1,
      closed: -0.1,
      updated: -0.1,
      commit: -0.25,
      reviews: [
        { login: priya.githubLogin, state: "APPROVED", offset: -0.15 },
        { login: ingrid.githubLogin, state: "APPROVED", offset: -0.15 },
      ],
      timeline: [
        { type: "requested", login: priya.githubLogin, offset: -0.25 },
        { type: "requested", login: ingrid.githubLogin, offset: -0.25 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 538,
      title: "Datum picker tooltip copy",
      state: "MERGED",
      authorLogin: ingrid.githubLogin,
      head: `${ingrid.githubLogin}/orb-132-datum-picker-tooltip-copy`,
      created: -0.2,
      merged: -0.05,
      closed: -0.05,
      updated: -0.05,
      commit: -0.2,
      reviews: [
        { login: dana.githubLogin, state: "APPROVED", offset: -0.1 },
        { login: theo.githubLogin, state: "COMMENTED", offset: -0.1 },
      ],
      timeline: [
        { type: "requested", login: dana.githubLogin, offset: -0.2 },
        { type: "requested", login: theo.githubLogin, offset: -0.2 },
      ],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 539,
      title: "Stale migration note cleanup",
      state: "OPEN",
      authorLogin: null,
      head: "stale-migration-note-cleanup",
      created: -12,
      updated: -9,
      commit: -12,
      reviews: [],
      timeline: [{ type: "requested", login: sam.githubLogin, offset: -10 }],
    }),
    buildPr(now, "orbital", "horizon", {
      number: 540,
      title: "ORB-130: Map pack publish follow-up",
      state: "OPEN",
      authorLogin: OUTSIDE_AUTHOR_LOGIN,
      head: `${OUTSIDE_AUTHOR_LOGIN}/map-pack-follow-up`,
      created: -1,
      updated: -0.05,
      commit: -1,
      reviews: [],
      timeline: [{ type: "requested", login: theo.githubLogin, offset: -0.05 }],
    }),
  ];
}

/**
 * The seeded PRs for one repo+state, wrapped as a GitHub `pullRequests` connection
 * page. This is what the fake-GitHub route returns: the discovery query asks per repo
 * and per state (OPEN / MERGED / CLOSED), so the route filters the same way.
 */
export function seedGithubPullRequestsPage(
  now: Date,
  owner: string,
  name: string,
  state: RawGithubPullRequestNode["state"]
): RawGithubPullRequestsPage {
  const nodes = seedGithubPullRequests(now)
    .filter((x) => x.repo.owner === owner && x.repo.name === name && x.node.state === state)
    .map((x) => x.node);
  return { pageInfo: { hasNextPage: false, endCursor: null }, nodes };
}
