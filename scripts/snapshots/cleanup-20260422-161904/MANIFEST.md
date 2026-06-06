# ADR-0009 Phase 2 cleanup DRY-RUN manifest

- Generated: 2026-04-22T16:19:06.068Z
- Mode: DRY-RUN (no writes)
- Target DB: localhost/godcrm_prod
- Allow-list file: scripts/cleanup-allowlist.json (owner_signed=true)
- Allow-list size: 92 users, 85 spaces, 1359 tables

## Test signatures
- email regex: `@test\.com|@example\.com|^test-`
- name regex:  `^test-.*-[0-9]{10,}$|^tables-test-`
- Agents (user_type='agent') and services (user_type='service') are unconditionally allow-listed regardless of regex match.

## Candidate summary
| Entity | Total in DB | To delete | To keep |
|---|---:|---:|---:|
| users | 5934 | 5842 | 92 |
| spaces | 5392 | 5306 | 86 |
| projects | 5689 | 5493 | 196 |
| universal_tables | 5130 | 3754 | 1376 |
| table_rows | 93513 | 1256 | 92257 |
| physical table_<N> | (n/a) | 0 | n/a |

## ADR Appendix A comparison
ADR predicted: 5878 users to delete, 5328 spaces to delete.
Actual: 5842 users, 5306 spaces.
Delta: users 0.6%, spaces 0.4%.
Delta within 10% — signature matches ADR audit.

## Dependent FK-by-convention child counts
| Table | Parent | Candidate rows | Note |
|---|---|---:|---|
| calendar_events | spaces | 0 | missing cols: start_at |
| modules | spaces | 289 | missing cols: name |
| widget_library | spaces | 1520 | missing cols: name |
| fitness_workouts | spaces | 10 |  |
| fitness_workout_sets | spaces | 24 | missing cols: id |
| fitness_exercises | spaces | 0 |  |
| wellness_profiles | spaces | 0 |  |
| wellness_points | spaces | 0 |  |
| wellness_levels | spaces | 0 |  |
| wellness_streaks | spaces | 0 |  |
| wellness_vitals | spaces | 0 |  |
| wellness_user_achievements | spaces | 0 |  |
| labs | spaces | 21 | missing cols: name |
| schema_layouts | spaces | 0 |  |
| space_invitations | spaces | 0 |  |
| conversations | spaces | 0 |  |
| files | spaces | 0 |  |
| dashboards | spaces | 710 |  |
| user_access_permissions | spaces | 0 |  |
| agent_jobs | users | 0 |  |
| terminal_sessions | users | 0 |  |
| terminal_commands | users | 0 | column user_id not found — skipped |
| tool_approval_rules | users | 0 |  |
| api_keys | users | 0 |  |
| audit_log | users | 36 |  |
| chat_participants | users | 0 | missing cols: conversation_id |
| conversation_participants | users | 283 |  |
| message_reactions | users | 0 |  |
| monitoring_runs | users | 0 |  |
| monitoring_threads | users | 0 |  |
| oidc_access_tokens | users | 0 |  |
| oidc_auth_codes | users | 0 |  |
| user_settings | users | 0 |  |
| user_widget_favorites | users | 187 |  |
| user_widget_history | users | 544 |  |
| wa_auth_tokens | users | 0 |  |
| wa_presence | users | 2 |  |

## Biggest individual deletes (by table_rows count)
| universal_table_id | rows |
|---|---:|
| 6383 | 3 |
| 6370 | 3 |
| 4337 | 3 |
| 3970 | 3 |
| 3968 | 3 |
| 3939 | 3 |
| 5805 | 3 |
| 7749 | 3 |
| 3989 | 3 |
| 4335 | 3 |

## Orphan-suspect users (NOT covered by current signature)
These users look test-ish (`register-<ts>@hltrn.cc`, name = "New User", etc.) but are NOT covered by the ADR regex, so they will NOT be deleted in the current plan. Owner should decide before Phase 3 whether to extend the regex. See orphan_suspects.csv.
Total: 12
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
| 1628 | test-auth-1776360379485-juhbuy@hltrn.cc | 1 | 0 | 0 |
| 3524 | test-auth-1776361827421-i7kiqi@hltrn.cc | 1 | 0 | 1 |
| 1298 | test-auth-1776360247628-2acwu5@hltrn.cc | 1 | 0 | 1 |
| 1627 | test-auth-1776360379296-xdkmeq@hltrn.cc | 1 | 0 | 1 |
| 2726 | test-auth-1776361251227-yftdzj@hltrn.cc | 1 | 0 | 0 |
| 3126 | test-auth-1776361711962-r17j4g@hltrn.cc | 1 | 0 | 0 |
| 296 | test-auth-1776360107173-uqkrj4@hltrn.cc | 1 | 0 | 0 |
| 871 | test-auth-1776360181437-a5hih7@hltrn.cc | 1 | 0 | 0 |
| 1302 | test-auth-1776360248000-ztb4r0@hltrn.cc | 1 | 0 | 0 |
| 1626 | test-auth-1776360379115-unqs9q@hltrn.cc | 1 | 0 | 1 |

## Estimated bytes freed
Rough proportional estimate (rows_to_delete / total_rows × table_size):
- users:            5.21 MB (of 5.30 MB)
- spaces:           0.89 MB (of 0.91 MB)
- projects:         0.91 MB (of 0.95 MB)
- universal_tables: 0.55 MB (of 0.76 MB)
- table_rows:       1.13 MB (of 83.77 MB)
- **TOTAL estimate freed:** ~8.70 MB (of DB main-table footprint 91.68 MB)
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
