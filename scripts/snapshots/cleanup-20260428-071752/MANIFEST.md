# ADR-0009 Phase 2 cleanup DRY-RUN manifest

- Generated: 2026-04-28T07:17:53.517Z
- Mode: DRY-RUN (no writes)
- Target DB: localhost/godcrm_prod
- Allow-list file: scripts/cleanup-allowlist.json (owner_signed=false)
- Allow-list size: 93 users, 85 spaces, 1359 tables

## Test signatures
- email regex: `@test\.com|@example\.com|^test-`
- name regex:  `^test-.*-[0-9]{10,}$|^tables-test-`
- Agents (user_type='agent') and services (user_type='service') are unconditionally allow-listed regardless of regex match.

## Candidate summary
| Entity | Total in DB | To delete | To keep |
|---|---:|---:|---:|
| users | 2601 | 2502 | 99 |
| spaces | 2376 | 2281 | 95 |
| projects | 2549 | 2341 | 208 |
| universal_tables | 3076 | 1675 | 1401 |
| table_rows | 97012 | 648 | 96364 |
| physical table_<N> | (n/a) | 0 | n/a |

## ADR Appendix A comparison
ADR predicted: 5878 users to delete, 5328 spaces to delete.
Actual: 2502 users, 2281 spaces.
Delta: users 57.4%, spaces 57.2%.
**WARNING:** delta > 10% — regex may be wrong or allow-list may have too many/few entries.

## Dependent FK-by-convention child counts
| Table | Parent | Candidate rows | Note |
|---|---|---:|---|
| calendar_events | spaces | 0 | missing cols: start_at |
| modules | spaces | 108 | missing cols: name |
| widget_library | spaces | 552 | missing cols: name |
| fitness_workouts | spaces | 10 |  |
| fitness_workout_sets | spaces | 24 | missing cols: id |
| fitness_exercises | spaces | 0 |  |
| wellness_profiles | spaces | 0 |  |
| wellness_points | spaces | 0 |  |
| wellness_levels | spaces | 0 |  |
| wellness_streaks | spaces | 0 |  |
| wellness_vitals | spaces | 0 |  |
| wellness_user_achievements | spaces | 0 |  |
| labs | spaces | 12 | missing cols: name |
| schema_layouts | spaces | 0 |  |
| space_invitations | spaces | 0 |  |
| conversations | spaces | 0 |  |
| files | spaces | 0 |  |
| dashboards | spaces | 282 |  |
| user_access_permissions | spaces | 0 |  |
| agent_jobs | users | 0 |  |
| terminal_sessions | users | 0 |  |
| terminal_commands | users | 0 | column user_id not found — skipped |
| tool_approval_rules | users | 0 |  |
| api_keys | users | 0 |  |
| audit_log | users | 18 |  |
| chat_participants | users | 0 | missing cols: conversation_id |
| conversation_participants | users | 126 |  |
| message_reactions | users | 0 |  |
| monitoring_runs | users | 0 |  |
| monitoring_threads | users | 0 |  |
| oidc_access_tokens | users | 0 |  |
| oidc_auth_codes | users | 0 |  |
| user_settings | users | 0 |  |
| user_widget_favorites | users | 48 |  |
| user_widget_history | users | 162 |  |
| wa_auth_tokens | users | 0 |  |
| wa_presence | users | 2 |  |

## Biggest individual deletes (by table_rows count)
| universal_table_id | rows |
|---|---:|
| 8997 | 3 |
| 9243 | 3 |
| 9102 | 3 |
| 9300 | 3 |
| 8335 | 3 |
| 9264 | 3 |
| 9575 | 3 |
| 9601 | 3 |
| 9583 | 3 |
| 9570 | 3 |

## Orphan-suspect users (NOT covered by current signature)
These users look test-ish (`register-<ts>@hltrn.cc`, name = "New User", etc.) but are NOT covered by the ADR regex, so they will NOT be deleted in the current plan. Owner should decide before Phase 3 whether to extend the regex. See orphan_suspects.csv.
Total: 18
| id | email | name | spaces_owned | projects_owned |
|---|---|---|---:|---:|
| 290 | register-1776360106506@hltrn.cc | New User | 1 | 2 |
| 854 | register-1776360180839@hltrn.cc | New User | 1 | 2 |
| 1289 | register-1776360247162@hltrn.cc | New User | 1 | 2 |
| 1624 | register-1776360378848@hltrn.cc | New User | 1 | 2 |
| 2700 | register-1776361250530@hltrn.cc | New User | 1 | 2 |
| 3110 | register-1776361711329@hltrn.cc | New User | 1 | 2 |
| 3522 | register-1776361827012@hltrn.cc | New User | 1 | 2 |
| 4095 | register-1776361932372@hltrn.cc | New User | 1 | 2 |
| 4627 | register-1776362032786@hltrn.cc | New User | 1 | 2 |
| 5138 | register-1776362137277@hltrn.cc | New User | 1 | 2 |

## Shape-unexpected warnings
Candidate users with non-trivial downstream activity (see weird_candidates.csv):
| id | email | audits | dashboards | spaces_owned |
|---|---|---:|---:|---:|
| 7027 | test-auth-1777269633780-9d614z@hltrn.cc | 1 | 0 | 0 |
| 7017 | test-auth-1777269633217-053qz6@hltrn.cc | 1 | 0 | 1 |
| 8764 | test-auth-1777280131824-5j13am@hltrn.cc | 1 | 0 | 1 |
| 8771 | test-auth-1777280132190-k04tjd@hltrn.cc | 1 | 0 | 0 |
| 7467 | test-auth-1777269701461-pzchjl@hltrn.cc | 1 | 0 | 0 |
| 7928 | test-auth-1777280032965-udxzoa@hltrn.cc | 1 | 0 | 0 |
| 6568 | test-auth-1777269574153-w5hj68@hltrn.cc | 1 | 0 | 1 |
| 6577 | test-auth-1777269574564-xym9cb@hltrn.cc | 1 | 0 | 0 |
| 8769 | test-auth-1777280132016-nfteb7@hltrn.cc | 1 | 0 | 1 |
| 7022 | test-auth-1777269633468-m0wnhi@hltrn.cc | 1 | 0 | 1 |

## Estimated bytes freed
Rough proportional estimate (rows_to_delete / total_rows × table_size):
- users:            5.14 MB (of 5.34 MB)
- spaces:           0.91 MB (of 0.95 MB)
- projects:         0.91 MB (of 0.99 MB)
- universal_tables: 0.41 MB (of 0.76 MB)
- table_rows:       0.57 MB (of 85.41 MB)
- **TOTAL estimate freed:** ~7.94 MB (of DB main-table footprint 93.45 MB)
(Does not include per-index bloat or dependent child tables; actual free may be higher after VACUUM FULL.)

## Topological delete order (Phase 3 --execute)
- 1. table_rows  WHERE table_id IN (candidate universal_tables)
- 2. DROP TABLE table_<N>  (physical per-table PG tables for candidate universal_tables) — N/A, none exist
- 3. universal_tables  (candidate set)
- 4. all FK-by-convention children referencing candidate projects
- 5. projects  (candidate set)
- 6. all FK-by-convention children referencing candidate spaces (modules/widget_library/fitness_*/wellness_*/calendar_events/labs/schema_layouts/space_invitations/dashboards/files/conversations/user_access_permissions)
- 7. spaces  (candidate set)
- 8. all FK-by-convention children referencing candidate users (agent_jobs/terminal_*/tool_approval_rules/wa_*/audit_log/monitoring_*/oidc_*/api_keys/user_settings/user_widget_*/chat_participants/conversation_participants/message_reactions)
- 9. users  (candidate set)

All wrapped in a single `BEGIN; ... COMMIT;` transaction; any error triggers `ROLLBACK`.

## Files in this snapshot
- agent_jobs.csv
- api_keys.csv
- audit_log.csv
- calendar_events.csv
- chat_participants.csv
- conversation_participants.csv
- conversations.csv
- dashboards.csv
- files.csv
- fitness_exercises.csv
- fitness_workout_sets.csv
- fitness_workouts.csv
- labs.csv
- message_reactions.csv
- modules.csv
- monitoring_runs.csv
- monitoring_threads.csv
- oidc_access_tokens.csv
- oidc_auth_codes.csv
- orphan_suspects.csv
- physical_tables_to_drop.csv
- projects.csv
- schema_layouts.csv
- space_invitations.csv
- spaces.csv
- table_rows_summary.csv
- terminal_commands.csv
- terminal_sessions.csv
- tool_approval_rules.csv
- universal_tables.csv
- user_access_permissions.csv
- user_settings.csv
- user_widget_favorites.csv
- user_widget_history.csv
- users.csv
- wa_auth_tokens.csv
- wa_presence.csv
- weird_candidates.csv
- wellness_levels.csv
- wellness_points.csv
- wellness_profiles.csv
- wellness_streaks.csv
- wellness_user_achievements.csv
- wellness_vitals.csv
- widget_library.csv
