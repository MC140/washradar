# GTA FSA coverage audit

After catalogue discovery and Google Place Details enrichment, the admin workflow groups saved valid Canadian postal codes by Forward Sortation Area (the first three characters, e.g. `M1B` or `L5N`).

The audit reports:

- number of unique FSAs represented by at least one saved wash;
- prefixes with only one saved wash, which are flagged as suspiciously sparse for a follow-up search;
- records whose postal code could not be normalized.

This audit is a coverage-quality signal, not proof that every FSA necessarily contains a car wash. A later reconciliation pass should compare represented/sparse prefixes with Statistics Canada's Census Forward Sortation Area geography and the intended WashRadar service boundary before targeted gap searches are added.
