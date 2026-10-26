# BeatInflation documentation

The source of truth for what BeatInflation does, how it runs and how it is built. Everything here is versioned with
the code in git: a change to behaviour and a change to its document land in the same commit.

| Artefact | File | ID prefix |
| --- | --- | --- |
| Requirements: product hierarchy, products, capabilities, features, business rules | [REQUIREMENTS.md](REQUIREMENTS.md) | `SEC` `PRD` `CAP` `FEA` `BR` |
| Business processes (operations) | [PROCESSES.md](PROCESSES.md) | `BP` |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | `ARC` |
| Experience flows | [FLOWS.md](FLOWS.md) | `FLW` |
| Visual designs (one screenshot set per page) | [design/](design/README.md) | `PG` |
| Configuration | [CONFIGURATION.md](CONFIGURATION.md) | `CFG` |
| Credentials inventory (no secret values) | [CREDENTIALS.md](CREDENTIALS.md) | `CRD` |
| Codebase map | [CODEBASE.md](CODEBASE.md) | — |
| Change history | [CHANGELOG.md](CHANGELOG.md) | — |

The readable review copy of the requirements, with decision dropdowns, is the Claude doc
[BeatInflation super app: product requirements](https://claude.ai/artifact/FZgbxr9eYw6GY6WmaPTYQr). If the two
disagree, this repository wins.

## Versioning rules

1. **Document versions** use `MAJOR.MINOR` in each file's header. MINOR for added or reworded items; MAJOR when an
   item is removed or its meaning changes.
2. **IDs are permanent.** An ID is never reused or renumbered. A dropped item stays in the file marked
   `#status/retired` with the version it was retired in.
3. **Every item is tagged** so it can be filtered with a plain text search:

   | Tag | Values |
   | --- | --- |
   | `#phase/` | `P1` now · `P2` · `P3` · `P4` (the original rollout; all approved items are being built as P1) |
   | `#status/` | `live` (production) · `test` (test site only) · `planned` · `blocked` (waiting on a licence, partner or key) · `retired` |
   | `#source/` | `cdr` Open Banking · `aer` energy regulator · `abs` · `rba` · `scrape` · `wise` · `fuelwatch` · `sample` · `user` · `partner` |
   | `#licence/` | `none` · `acl` credit licence · `afsl` financial services licence · `phi` health insurance broker |
   | `#area/` | `ui` · `db` · `fn` (edge function) · `ops` · `legal` |

4. **Releases** are tagged in git as `release-YYYY-MM-DD`. Documentation snapshots are tagged `docs-vMAJOR.MINOR`
   when a document's version changes.
5. **Credentials are never written here.** [CREDENTIALS.md](CREDENTIALS.md) records where each one lives and who owns
   it; the values stay in a password manager or Supabase's secret store.
