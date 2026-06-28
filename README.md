# Mach9 Project: Standup Gantt

Welcome to Mach9's project. You'll build a frontend application that helps an
engineering team run standup from a Gantt-style view of active work: Linear issues,
related GitHub pull requests, review requests, status changes, due dates, and work
that is blocked, in review, done, cancelled, or not yet clearly scheduled.

Spend around eight to ten hours of active work. We expect you to use AI coding tools like Cursor, Claude Code, Codex, or similar tools; we build with them every day. You won't be penalized for using AI. We're evaluating the result and how you directed, verified, refined, or rejected AI-generated work. The AI can help write code, but the product decisions and tradeoffs should be yours. We will be asking why you made certain decisions, used certain components or interactions, and how it mapped to what you think would make for an effective standup gantt chart app.

**WARNING:** If you just ask Claude to do this project for you, and don't iterate and provide your own judgement and craft, your project will not be good. You need to make informed design decisions and execute on them. We will be evaluating your judgement and taste.

The repo runs locally and includes a local **Fake source** with fictional issues,
pull requests, people, and projects. It serves Linear's and GitHub's own GraphQL wire
shapes so you can spend your time on product experience, data modeling, interaction
design, and implementation quality instead of credentials or infrastructure.

## Run it

Fork this repository, clone your fork locally, then install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The home page is a near-empty **starting skeleton**: it
posts one example GraphQL query to each Fake source endpoint and pretty-prints the raw
payloads, so you can confirm data is flowing and see the wire shapes within minutes.
No Mach9 credentials, real Linear access, real GitHub access, database, Docker, or
deployed service is required.

Other commands:

```bash
pnpm test        # run the Fake source tests (and your own)
pnpm typecheck   # tsc --noEmit
```

## What to build

Build a per-person Gantt-style standup board for the seeded team. It should show each
person's Linear issues and pull requests over time, with enough status and interaction
detail that a team could use it to talk through standup.

The useful view is not a plain task list. It should help the team answer questions
quickly:

- What is each person working on right now?
- What is coming up next?
- Which items are in review, blocked, done, or cancelled?
- Which pull requests need attention?
- Where does the plan implied by the issue data differ from how the work actually
  seems to be moving?
- What actions should someone be able to take without leaving the board?

This is intentionally open-ended, and we want your perspective. A solid scoped
submission should include:

- **A useful Gantt view.** Show work on a timeline, grouped by person, with readable
  bars or markers for issues and pull requests. Make the time scale, grouping, and
  visual hierarchy clear enough that someone can orient quickly.
- **Status indicators.** Surface meaningful states such as active work, review, done,
  cancelled, blocked, or other states you think matter. Decide how status should
  affect color, labels, ordering, and emphasis.
- **Pull request and review handling.** Use the GitHub data to show pull requests and
  review obligations in a way that helps the team understand what needs attention.
- **Issue actions.** Let someone create a new Linear issue and change a Linear issue's
  status through the fake Linear source.
- **Responsiveness and polish.** The board should remain pleasant to use as the seeded
  data grows denser. We notice loading, empty, and error states, responsive behavior,
  interaction details, and visual rhythm.
- **A point of view.** Decide what belongs on the board, what should be hidden or
  secondary, how local planning state should work, and what you would improve next if
  this became a real product.

You are welcome to go beyond this. Examples might include drag interactions,
filtering, search, zooming, better review consolidation, issue creation affordances,
keyboard shortcuts, local planning state, or a stronger component system. Do not try
to do everything. A smaller surface done with care is better than a broad but shallow
implementation.

## The Fake source

- `POST /api/fake/linear` -- fake-Linear (GraphQL: issues read + the writes Linear allows)
- `POST /api/fake/github` -- fake-GitHub (GraphQL: pull requests + reviews, read-only)
- `lib/fake-source/` -- the seed dataset, the write store, and their tests. Read the
  tests: they document exactly what each endpoint returns and rejects.

The Fake source impersonates the external systems of record; it is not an app
database. The raw payloads are the providers' wire shapes on purpose. You write the
normalization yourself: flattening nested nodes, resolving each PR to its Linear issue
from branch names or titles, pairing GitHub review-request events to submissions,
dropping mooted requests, and filtering out bot and outside-contributor noise.

The seed dataset is deterministic and dates are computed relative to "now" at request
time, so the board is always populated around today whenever you run it. It includes
edge cases such as every status, planned-vs-actual start, open-ended work,
clipped-left long bars, no-span issues, cancelled work, automation-owned states,
pending/completed/mooted/bot reviews, re-requested review events, branch-name vs title
PR resolution, and a stacked-PR chain.

The Fake source also enforces real Linear/GitHub constraints:

- **No writable issue start date.** A planned start is app-owned, not Linear's. Only
  the due date writes through. fake-Linear rejects any write that sets a start date.
- **GitHub reviews are read-only.** fake-GitHub rejects every mutation.
- **App-owned state is your decision.** Presentation state with no home in Linear or
  GitHub, such as lane placement and planned starts, has no Fake source endpoint.
  Client-side state is reasonable for a single-user local app.

## Deliverables

Send us:

- A link to your repository.
- A short `NOTES.md` explaining the major product and technical decisions you made,
  what is incomplete, what you would do next, and how you used AI tools.
- Your AI-session transcripts or representative excerpts where available. We want to
  see how you direct the tools, where you push back, how you debug, and what you keep,
  refine, or throw away.

## Presentation

Afterward we'll book an hour for you to present to the team: 15-20 minutes walking
through your product, code, and decisions, with the rest for questions. We'll ask you
to justify design decisions and may challenge them or introduce new requirements to
see how you reason and adapt. Incomplete is expected under a one-day box; we'd rather
see a few things done with real care than everything half-built.

## How we'll evaluate

- **Product judgment** -- what you chose to build, what you chose to cut, and how well
  the board supports a real standup workflow.
- **Timeline and data modeling** -- how you normalize source data, represent spans and
  statuses, handle edge cases, and make the result understandable.
- **Component quality and reuse** -- whether your UI is composed from clear,
  maintainable components a team could extend.
- **Design craft and visual detail** -- whether the interface feels considered,
  polished, and clear under dense data.
- **Interaction design** -- whether issue actions, review handling, navigation, and
  timeline controls feel coherent and easy to use during a fast standup.
- **Performance under load** -- whether the board stays responsive as the data gets
  denser.
- **Use of AI coding tools** -- how effectively you direct the tools, verify their
  output, and keep judgment in the loop.
- **Code quality** -- readable, modular, maintainable code, even where incomplete.

Stack: React + TypeScript on Next.js. Time box: ~10 hours.
