---
title: Deleted accounts keep their compliance documents for 7 years
category: decision
created: 2026-11-15
updated: 2026-11-15
related: [[stock-model-and-storage-areas]]
---

Deleting a user (admin deletion or "Delete my account") anonymises the user row and does **not** touch that person's staff compliance documents, and does not archive them. They stay on the existing retention schedule.

## Decision
Owner decision, 2026-11-15: leave them on the 7-year schedule (Fair Work Regulations 2009 reg 3.44, employee records).

## What that means in code
- `userAnonymisationService` leaves `compliance_document` rows alone; the foreign keys to the user row stay valid because the row is kept.
- A document with an `employment_end_date` is purged when its 7-year window ends (`isRetentionExpired`).
- A document with no end date (the person was never offboarded) is purged by the orphan sweep (`isOrphanedInactive`). For a deleted account that waits **over 7 years** from deletion (`user.updated_dttm`, stamped by the anonymiser). For a suspended or cancelled account it is still 2 years.

## Why the sweep was changed
It had one window, 2 years, for every non-active account. A deleted account is non-active, so its documents would have been purged 2 years after deletion, short of the 7-year decision. The sweep now picks 7 years for `user_status = 'deleted'`.

## Not decided here
Whether a deleted person's documents should stop being viewable by managers straight away (archiving does that). Today they remain viewable with the identity scrubbed.
