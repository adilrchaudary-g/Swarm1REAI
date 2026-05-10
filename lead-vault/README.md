# Lead Vault

Filesystem-first storage for harvested and worked lead data.

## Purpose

This folder replaces the idea that PropStream lead organization needs to live in Discord. The system can still emit summaries elsewhere, but the lead vault is the local system of record for harvested lead artifacts and pipeline-stage organization.

## Layout

- `acquisition/propstream/`
  - raw and normalized harvest output written by `propstream-runner`
- `pipeline/intake/`
  - leads staged for intake review or normalization
- `pipeline/enriched/`
  - leads that have been enriched with owner/context fields
- `pipeline/queue/`
  - active, prioritized leads worth human attention
- `pipeline/done/`
  - dead, closed, or otherwise terminal records

## Safety

Lead data and contact data in this tree are sensitive. The scaffold is kept in git; harvested contents are gitignored.
