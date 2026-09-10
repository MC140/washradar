# Safe queue transaction test plan

The automated synthetic production agent stays read-only. Do not seed fake public queue activity just to make CI green.

Before native store release, run this controlled test at a real wash with two independent devices or two explicit test identities while physically present:

1. Device A opens the same wash and submits **Update queue** with the observed cars-ahead bucket.
2. Record the accepted verification (`nearby`) and timestamp.
3. Device B opens/refreshes the wash and confirms the new cars-ahead/wait evidence appears within the expected queue-refresh window.
4. Device A optionally starts **Start wait timer** after fresh GPS proximity verification.
5. Background/lock Device A for a representative interval, then reopen it and verify the elapsed timer restores from the server-backed start timestamp.
6. When the wash actually starts, Device A chooses **My wash started**.
7. Verify exactly one completed wait is stored, the queue estimate recalculates, contribution metrics/history update and rewards/challenges are not duplicated.
8. If any test-generated record is inappropriate to leave in production, disable/remove it through the existing moderation/admin path and confirm the public estimate is recalculated.

Pass criteria:
- quick queue reporting helps Device B without requiring Device A to start a timer;
- wait timer is optional, proximity-verified and survives foreground/background transitions;
- no duplicate points or completed waits;
- no exact GPS trail is exposed publicly;
- user-facing wait/cars state remains understandable when evidence expires.
