# Recorder completeness protocol handoff

Status: local implementation for review, not deployed or verified with a real meeting. Baseline: `2533a02c7545d9f64acb14c3a5696e4848db5e63` on `codex/talktoduo-recorder-durability`. Consumer: TalkToDuo `agent/ttagent/meetings.py` in `codex/talktoduo-production-readiness`.

## Contract

1. The bot uploads each MediaRecorder timeslice with its browser sequence number. It accepts an upload only when the API answers with `durable_ack: true` and the same `chunk_seq`. The existing HTTP uploader retries twice. A permanently failed upload prevents later queued chunks and the final marker from being delivered as a successful recording.
2. A real browser final marker carries `final_proof: true`. A host-side synthetic close marker carries `final_proof: false`; it records that the bot stopped but cannot prove the browser emitted its last chunk. Missing upload URL and pending/non-ACK replies fail the uploader.
3. The API stores a SHA-256 digest per sequence in the recording JSONB, a final sequence number, and any conflicting retry. Identical retries keep byte and chunk counts unchanged. The upload receipt is sent only after object storage upload and JSONB fold return. The API refuses a master when sequence numbers have gaps, a final sequence has missing parts, bytes differ from their recorded digests, a retry conflicts, or a proven final has no audio. `GET /recordings/{id}/master` and `/raw` answer HTTP 409 for these cases.
4. The master response includes `completeness: verified | unverified` and `chunk_count`. `verified` requires a real final, contiguous stored chunks, matching SHA-256 digests, and matching object/JSONB counts. A synthetic final and legacy recordings without proof remain `unverified`; partial legacy playback may still be available. For new strict uploads, recording status stays `in_progress` until all expected sequences arrive.
5. TalkToDuo downloads and ingests only `completeness: verified` with a positive integer `chunk_count`. Missing proof fails closed before audio is processed. Its existing media failure settlement releases the held processing credits; the bot allowance is not settled as a usable recording. HTTP 409 can be retried during the media grace window before it settles failed.

## Rollout and rollback

1. Review and deploy the Vexa meeting API first. It accepts old bot uploads, returning the additive ACK field and `unverified` for old recordings. Existing clients may still play legacy partial masters; TalkToDuo must not be upgraded yet. Verify API health, object storage access, and the new 409/metadata behavior in an isolated fixture or staging stack.
2. Deploy the Vexa bot image using the matching recording module. In a **separately authorized** controlled Meet, check that the browser final arrives, every chunk receives an ACK, and `/master` returns `verified` before any downstream job begins. Exercise a failed upload and a lost final marker; neither may yield `verified`.
3. Deploy the TalkToDuo consumer only after step 2 passes. A preexisting or old-provider master lacks proof and will fail closed. Drain in-flight recording and media jobs before replacing the consumer. Check settlement and a complete audio/transcript on the controlled account.
4. Roll back the TalkToDuo consumer first if the new proof contract is unavailable, then the bot, then the API. Do not revert database or object storage to an older snapshot over newer recordings. Keep the API additive fields until every bot and consumer that uses them is retired. If an incomplete recording was already exposed, treat it as failed/partial and reconcile its hold and bot allowance; do not relabel it complete.

## Verification and remaining limits

- Local offline evidence: meeting API suite 1,428 passed, 5 skipped (before the final empty-only guard); recording tests 27 passed after that guard. Bot recording L3 test, recording module build, and bot TypeScript typecheck passed. TalkToDuo `test_meetings` 88 passed after concurrent billing code became available. No production or admitted Meet run is claimed.
- The bot has HTTP retry and a sequenced in-memory queue, **no persistent spool across bot/container loss**. A permanent upload failure becomes an incomplete recording. Recovery of already ACKed chunks is possible from object storage; missing unACKed bytes may be irrecoverable.
- Object-store existence check and write are separate operations. Concurrent conflicting writers for the same sequence can race; master hash verification prevents a false `verified` result, but preserving the first bytes under such a race needs conditional object writes or content-addressed keys. A single bot serializes its uploads, so this is primarily a defensive multi-writer limit.
- API-level tests use in-memory storage and repository fakes. They do not prove MinIO durability, actual browser chunk behavior, audio fidelity, active recording capacity, or production settlement.
