# The night on one VM

Every night one small VM in `koryta-pl` boots, runs everything that keeps the
data current, and switches itself off. It runs after the site's 02:00 export,
when nobody is still editing, and compares tonight's people with that copy:

| Warsaw time | What                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 02:00       | `scheduledFirestoreExport` copies the site to `gs://koryta-pl-crawled/hostname=koryta.pl/date=<UTC>/` |
| 02:15       | the instance schedule boots `koryta-nightly` (up to 15 minutes late, the docs say)                     |
| 02:30       | `koryta-nightly.timer` starts `koryta-nightly.service`: `night.sh`, then `koryta_nightly`              |
| ~04:30      | `declarations`: the site counts the declarations in people from predator's newest facts                |
| ~04:30      | `compute_nodes`: autopush recounts every page's stats, the search lines among them                     |
| ~04:30      | the night is over; `poweroff.sh` switches the VM off                                                   |
| 06:30       | `--stop-by`: no step but `compress` and `tidy` starts after this                                       |
| 07:00       | the instance schedule stops the VM, if a night hung                                                    |

The night is over before the working morning (decision on 2026-11-20). On
the last Sunday of March the clocks skip
02:00-03:00: the VM boots at 03:15 and the night starts at 03:30, after an
export Cloud Scheduler may run at 03:00 or skip (a skipped one holds that
night's people). In October the hour repeats and the export may run twice.

`night.sh` brings the checkout up to `KORYTA_REF` (`origin/main` by default),
syncs the venv, builds the compressor, reads the secrets, and hands over to
`koryta_nightly` (`data/pipelines/src/jobs/nightly`), which runs the steps in
order, each with a time limit and its output in the night's log:

| Step              | What                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compress`        | the compressor, `-incremental -hostname` for rejestr.io, then api-krs.ms.gov.pl: the whole previous day in UTC                                     |
| `export`          | waits for tonight's export: the newest one with its `.overall_export_metadata`, taken at most 6 h before the night                                 |
| `krs_free`        | `koryta_scrape_krs_free --max-minutes 60`: the bulletin, then api-krs                                                                              |
| `krs_register`    | `koryta_krs_register_owners --new-registrations --reads 0 --max-minutes 25`: who owns each newly registered company                                |
| `krs_odpis`       | `koryta_krs_odpis --graph --changed-since <yesterday> --queue --missing site --max 300`: odpisy pełne, see below                                   |
| `krs_index`       | `koryta_krs_full_index --daily --backfill 0 --max-minutes 25`: the free KRS index, the bulletin's companies (below)                                |
| `krs_paid`        | `koryta_scrape_krs_paid --scope fallback --max-calls 50`: rejestr.io for what the free sources could not give                                      |
| `wikidata`        | `koryta_wikidata_people --max-requests 100`: the Wikidata items of the people with a pl.wikipedia link, those whose revision moved                 |
| `rebuild_held`    | `koryta <Name> --refresh <Name>` for each held pipeline whose code changed since this VM last built it (below)                                     |
| `reprocess`       | `koryta --all-pipelines --refresh all`, as the CI nightly, less the article branch, the BIP documents and the slow static sources (`HELD`)         |
| `tests`           | `pytest src/tests/pipelines` over the night's outputs                                                                                              |
| `outputs`         | `pytest -m e2e src/tests/e2e`: the outputs against `baseline.json`                                                                                 |
| `invariants`      | `pytest -m e2e src/tests/pipelines`: the database invariants, over tonight's export                                                                |
| `companies`       | the `people` command and `--companies-only`: the companies its people name that tonight's export has no page for                                   |
| `people`          | `koryta_people_import --scope priority --max-uploads 100 --max-odpis-only-current 10 --max-rejestrio-current 50 --max-published 10 --refresh none` |
| `company_updates` | `koryta_company_import --max-uploads 200 --max-renames 0`: what tonight's data changes on the companies the export has (below)                     |
| `scores`          | `koryta_score_import`: the scoring models rebuilt, tonight's new pages included, and their votes reconciled                                        |
| `news_watch`      | `koryta_news_watch --since <yesterday> --max-queries 20`: the news for the board changes the bulletin showed, to the crawl's url store (below)     |
| `declarations`    | `koryta_bip_declarations send-facts`: predator's newest facts, with tonight's list, to the site, which counts the declarations in people (below)   |
| `compute_nodes`   | `koryta_uploader --type computeNodes --endpoint https://autopush.koryta.pl --submit`: the site recounts every page's stats (below)                 |
| `tidy`            | export shards and day-named outputs older than a week off the disk                                                                                 |

The VM keeps its disk, so `versioned/`, the download cache, the listing ranges
and the odpis parse memo carry over from one night to the next: the jobs run
the warm path they were measured on, on predator, rather than a cold container
fetching everything again.

## What the night buys

rejestr.io charges 0.05 PLN a call, so the night buys only what the free
sources cannot give (`--scope fallback`), before the rebuild, so that what it
buys reaches the same night's people - who send those pages first, right after
the new hires:

- the person feeds of the people somebody marked interesting - a vote on the
  site, a page published since `PUBLISHED_SINCE` (2026-07-11, moved back a step
  at a time; `scrapers/krs/scrape.py`), or the hardcoded list - which no
  register says. A vote or a publication buys the entry the page links; a page
  without a link is matched by name, namesakes and all;
- the connections of a company whose odpis pełny `krs_odpis` asked for and did
  not get: the gateway or the network ate it twice, or the service answered
  with something the job could not take (`KrsOdpisAttempts`, the fold of the
  odpis job's run record). A company it has not asked about yet waits for it;
  `krs_odpis` asks for the queue's right after the bulletin's (below).

At most 50 calls a day (`--paid-max-calls`): what the crawl bucket already
holds from rejestr.io that day counts against it, so a night run twice buys no
more than once. People first, then public companies. What the cap leaves waits
for the next night, which reads as "partial". A refused account - a key
rejestr.io does not take, no credit left - fails the step; nothing waits on it,
so the people go up either way. The step reads the key from Secret Manager
itself (`rejestr-io-key`) and gives it to the paid job alone; without it the
step is skipped, and the night's log says why.

## New companies in the register

A company a gmina, a powiat or the Treasury sets up sits in no seed list and in
nobody's rejestr.io feed, so no door of the crawl ever reached one. Powiatowe
Centrum Sportu i Rekreacji (KRS 0001192039, Powiat Włocławski, registered
2025-09-03) was found by hand a year later. `krs_register` asks api-krs for the
odpis aktualny of every number the bulletin says was registered since the
register's log began (`koryta_krs_register_owners --new-registrations`): 231 to
307 a working day from 2026-09-29 to 10-08, none at weekends, two or three
minutes a night. Every answer goes to the log,
`gs://koryta-pl-sharedcache/jobs/krs_register_owners/responses/`, as write-once
parts the VM's account adds under its create-only grant.

Tonight's reprocess folds the log (`KRSRegisterEntries`) and picks out the
companies the public owns (`CompaniesPublicByRegister`). The crawl's queue takes
them in through its `public_owner` door, and the next night's `krs_free`
fetches their odpis aktualny, which puts them in the graph (`CompaniesKRS`). The
night after, `krs_odpis` asks for their odpis pełny as public companies with
none on file (below), and their boards go up with that night's people.

The rest of the register is the backlog: some 700k numbers the bulletin named
that nobody has asked about, read oldest number first, and the answers it has
moved on from since. The night reads `--register-backlog` of them, 0 until
the pace is decided (task `decide-register-sweep-pace`). About 2,500 reads, the
new ones included, fit the step's 30 minutes; it stops itself five minutes
short and leaves the rest to the next night. A company registered before the
log began on 2026-09-28 - 0001192039 among them - is in the backlog, not among
the new ones.

## Wikidata

`wikidata` runs after `krs_paid` and before the reprocess, which builds
`WikidataPeople` (`versioned/wikidata_people/`) from what it leaves: for every
person with a pl.wikipedia link the item's QID, birth date with its precision,
parties and positions with their dates and qualifiers, occupations and
citizenship, whether the birth date agrees with the site's (`birth_check`:
exact, year_only, different) and which links are dead (`link_status`).
Nothing goes up to the site; the step holds nothing back, and a failed one
leaves last night's cache for the reprocess.

`koryta_wikidata_people` (`data/pipelines/src/jobs/wikidata_people`) keeps its
cache in `downloaded/wikidata/` on the VM's disk, under 0.5 MB for the 752
people linked on 2026-11-26:

- title -> QID comes off two dumps, `plwiki-latest-page.sql.gz` (147 MB) and
  `plwiki-latest-page_props.sql.gz` (48 MB): `page_props` names pages by id
  only, so it needs `page` to get to a title. A night asks for both with their
  ETag and gets a 304 until Wikimedia publishes new ones, twice a month;
  mapping 751 titles off them takes 6 s. What the dumps lack goes to
  wbgetentities by sitelink, then to pl.wikipedia, which tells a dead link
  from an article without an item;
- an item is read again only when its `lastrevid` moved: wbgetentities
  props=info, 50 items a request, about 7 KB each;
- requests go one at a time, a second apart, as `koryta-pipelines/<version>`,
  and a 429 or 503 waits out its Retry-After. `--wikidata-max-requests` (100)
  caps the step; what it leaves is the next night's (exit 75, partial).

Measured on 2026-11-26 over the public copy's 752 people:

| Run                          | Requests                                      | Over the wire   | Time  |
| ---------------------------- | --------------------------------------------- | --------------- | ----- |
| first (no cache, no dumps)   | 25: 2 dumps, 15 items, 6 labels, 2 dead links | 195 MB + 9.6 MB | 92 s  |
| a night when nothing changed | 19: 2 × 304, 15 revision checks, 2 dead links | 0.11 MB         | 27 s  |
| again inside 20 h            | 0                                             | 0               | 0.5 s |

So 30 seconds most nights, a minute and a half the night after a new dump;
the step may take 10 minutes.

## Odpisy pełne

`krs_odpis` asks the ministry's search service for the odpis pełny of the
graph's companies the bulletin named since yesterday - 57 to 70 a night from
2026-10-06 to 10-09, a minute's work. Then it asks for the companies the
crawl's queue owes rejestr.io's connections for (`--queue`), the public ones
first, as `krs_free` left the queue minutes before: `krs_paid` buys those only
once their free odpis was asked for and did not come, and the bulletin and the
gap below reach only some of them, so the rest were neither fetched nor bought.
On 2026-10-15 that was 960 of the queue's 1,024, 493 of them private, about
five nights at ~235; afterwards it is what the night's person feeds and doors
add. One in the queue for its odpis aktualny alone is `krs_free`'s.

With the rest of its 300
(`--odpis-max`) it asks for the public companies that have no odpis pełny on
file at all (`--missing public`): a company that came into the graph after its
last register entry is not named by the bulletin until its next one, which may
be years off, so the bulletin alone does not bring its odpis. On 2026-10-09 that
was 4,153 of the 6,612 public companies: 2,901 live and 1,252 the register has
struck off. The live ones go first, about 13 nights at ~235 a night, with 402
of the 739 live companies whose only source was rejestr.io's historical feed
among them. The struck-off ones - 1,050 of them public only since the
struck-off owner rule - follow in about 5 more: the service gives their odpis
too, with the boards they had. In the graph's order, which is the KRS number's, they would
have taken 130 to 184 of each of the first seven nights. Afterwards it is
whatever enters the graph. Within each, companies never asked come first, then
those whose last attempt got no answer; one the service said is in neither
register is not asked again.

Then the companies the site has a page for and the pipeline calls private
(`--missing site`), in `CompaniesLikelyPublic`'s order, most likely public
first. Nothing else asks for them: a struck-off one is never named by the
bulletin again, so a public owner only its odpis names stays hidden. On
2026-11-19, 529 of them had no odpis of any kind and about 2,300 no odpis
pełny parsed: two weeks or so of the room the step had left in November, when
it asked for 3 to 250 of its 300 a night. The step reads last night's list and
never rebuilds it.

The other private companies with none on file - 9,095 on 2026-10-09 - wait
for `--odpis-missing all`. The service slows
down after about 1,000 documents a run, which `--odpis-max` keeps the step well
under, queue, gap and all: while the queue's companies take the nights, the
gap waits for them. An odpis that does not come is what `krs_paid` buys
rejestr.io's feeds for, so a gap company the gateway eats can cost two of its
50 calls.

## The free KRS index

`krs_index` keeps an index of who sat where in the ~12.7k companies the site
has a page for, free (`koryta_krs_full_index`, `scrapers/krs/full_index.py`).
It asks api-krs for the odpis pełny **JSON** of every tracked company the
bulletin named on or after the day it was last read, plus the reads that
failed: about 55 a day (51 and 57 on 2026-11-24 and 25), one request each
once the register is known, a minute at 1 request a second. Every answer goes
verbatim to `gs://koryta-pl-sharedcache/jobs/krs_full_index/reads/` as
write-once zstd parts the VM's create-only grant adds, and to the disk
(`downloaded/krs_full_index/`, one file per company and state of its odpis,
~12 KB compressed), so a night killed mid-step loses no request.

The JSON gives every board, supervisory-board and prokura seat with the
entries that began and ended it and their days; it masks the people. The
reprocess lends them the identities of the PDF `krs_odpis` already fetches
(`KrsOdpisSeats`'s PESEL fingerprints): a seat is matched on the company,
the role, its first entry, the masked names' initial and length and the
PESEL's first digit (`KrsPositionsIndex`). `KrsPersonPositions` is one row per
fingerprint, every post across the indexed companies with its days, and
`KrsIndexCompanies` says which companies' JSON names somebody their PDF on
file does not - the ones that owe `krs_odpis` a new PDF.

api-krs sends no `ETag` and no `Last-Modified` and answers `If-Modified-Since`
with a full 200, uncompressed, whatever `Accept-Encoding` says (measured
2026-11-26). What saves requests is the bulletin: a company it has not named
since the read is never asked again, and the disk answers a rerun.

Measured on 2026-11-26 over 30 tracked companies from the site's export (15
public, the audit's sample), at 1 request a second:

| Run                     | Requests | Bytes in | Waiting on api-krs | Wall time |
| ----------------------- | -------- | -------- | ------------------ | --------- |
| cold (empty disk)       | 41       | 2.48 MB  | 6.0 s              | 40.7 s    |
| warm (the disk current) | 0        | 0        | 0                  | 0.1 s     |

41 for 30: 11 associations, foundations and SPZOZ answered 404 in P before S;
with the register known, 30. All 30 came back with an odpis, the 5 the odpis
aktualny answers 204 for among them: the odpis pełny serves a company struck
off or in liquidation, with its boards. 997 seats, every one dated, 789 ended.
The log holds them in 124 KB (1.25 MB of JSON). A full pass over the tracked
companies is 12.7k to 17.4k requests, 3.5 to 4.8 hours, ~1 GB in and ~55 MB
of log: a hand run on predator or the VM, or `--index-backfill` of them a
night (default 0; about 1,000 fit the step):

    koryta_krs_full_index --backfill 13000 --max-minutes 300   # resumes where it stops

`--paid-free-index` (off by default) has `krs_paid` buy nothing the index
already knows (`koryta_scrape_krs_paid --free-index`,
`plan.covered_by_index`):

- a person feed, current or past, where the index counts at least as many of
  the person's posts as rejestr.io's own count says the feed lists
  (`RejestrIOPersonCounts`). The person is placed through `PeopleKRSCombined`,
  whose rows carry their rejestr.io id and the fingerprint it was matched to;
- a company whose odpis pełny PDF did not come, where the PDF on file already
  names everybody its newest JSON does, and no seat the JSON ends stands in
  the PDF.

What stays paid: a person somebody named (a vote buys them whatever the count
says), a person the index cannot place or rejestr.io has no count for, and
**every post in a company outside the index** - where else in the ~1.28m
numbers somebody sits. api-krs cannot be searched by person and the JSON's
masking cannot join one company's people to another's, so that is the one
question nothing free answers. The run summary counts what the index saved
(`index_covered` calls, `index_pln`); `koryta_scrape_krs_paid --scope fallback
--free-index --dry-run` on the VM says what it would save tonight, before the
night switches over.

## The held pipelines, when their code changes

The reprocess holds nine pipelines at what is on disk (`HELD`): their sources
change with a Wikipedia dump, an election, a GUS release, a hand-made copy of
the CRU database or a scrape of KMGP's map taken by hand, not overnight. Their
code changes more often than that, and until 2026-10 nothing noticed:
PeoplePKW sat at an 08-28 build through eight commits to `scrapers/pkw`, and
`test_person_pkw` failed every night for it.

`PeopleKMGP` joined them on 2026-10-15. It spent 6 to 10 minutes of each
reprocess from 2026-10-13 to 15 matching the same 1,556 people of the
2026-05-17 scrape again, for an output nothing the night builds or checks
reads.

`rebuild_held` rebuilds, before the reprocess, the six the VM can rebuild in
minutes, when the code they are built from has changed (paths under
`data/pipelines/src`; times from a rebuild on predator, 2026-10-10):

| Pipeline             | Built from                                                                      | Rebuild              |
| -------------------- | ------------------------------------------------------------------------------- | -------------------- |
| `Regions`            | `scrapers/map/teryt.py`                                                         | 1 s                  |
| `PostalCodes`        | `scrapers/map/postal_codes.py`                                                  | 1 s                  |
| `NamesCountByRegion` | `analysis/utils/names.py`                                                       | 3 s, 0.8 GB          |
| `FirstNameFreq`      | `analysis/utils/names.py`                                                       | 1 s                  |
| `CruUmowy`           | `scrapers/cru`, `entities/cru.py`                                               | 71 s, 1.2 GB; 1.7 GB |
| `PeoplePKW`          | `scrapers/pkw`, `scrapers/map/teryt.py`, `util/polish.py`, `entities/person.py` | 173 s, 6.2 GB        |

Not `ProcessWiki` - 40 minutes parsing a 2.9 GB dump, rebuilt by hand - nor
`PeopleKMGP`, rebuilt by hand too, after the scrape by hand that changes it; and
never `CruDump`, which needs the CRU Postgres.

For each, the step asks git for the hash of every path in the checked-out
commit (`git rev-parse HEAD:<path>`) and compares them with the ones recorded
in `/var/lib/koryta-nightly/held-built-from.json` after its last build here. A
difference, or no record, and it runs `koryta <Name> --refresh <Name>` on its
own, the other held pipelines held. The output is backed up as `main`, as the
reprocess's are - all but CruUmowy's, which stays on this disk. The reprocess
still holds the pipeline, and reads what the rebuild wrote. File times could
not have told: a restored backup's file is dated 1970, the tar member's time.

So the first night with the step rebuilds all six once: some five minutes when
PKW's 121 files (773 MB) are already on the VM's disk, longer when PeoplePKW
has to download them first.

A rebuild that fails, or does not fit the step's 30 minutes, puts back the
copy that was on disk before it and records nothing, so the next night tries
again. The step is then partial - "nie przebudowano: PeoplePKW (kod wyjścia 1)
- zostają kopie z dysku" - which neither fails the night nor holds the people.
The night's summary lists what was rebuilt and why (`rebuilt`) and what was
due and was not (`not_rebuilt`); /admin/procesy counts the rebuilds
(`przebudowane`) and shows a partial step among the run's errors.

A rebuilt pipeline can change what the checks find, and a test that newly
fails holds the people as any other would: that is the change somebody has to
look at. To have one rebuilt the next night whatever its code, take its entry
out of `held-built-from.json`. What the step would rebuild now, without
rebuilding anything:

```bash
sudo -u koryta /home/koryta/koryta/data/pipelines/.venv/bin/koryta_nightly \
  --only rebuild_held --dry-run
```

## What the night uploads, and what holds it back

Pipeline outputs: every one the reprocess rebuilds goes to the shared cache as
`user=main` (`USERNAME` in `/etc/koryta/nightly.env`). A restore anywhere now
prefers the newest of the restoring user's own backups and `main`'s
(`stores.storage.MAIN_USER`), so a machine that built something last week takes
this morning's copy.

People: at most 100 a night (`--max-uploads`), in this order
(`analysis/payloads/priority.py`):

1. somebody the site has no page for, with a public post that began in the
   last 30 days and has not ended - the page is created unpublished, so they
   reach the review queue, not the site. Those only an odpis names, with no
   rejestr.io entry, take at most a tenth of the night (`--max-new-odpis-only`);
2. a page the payload would change, of somebody whose rejestr.io feed was
   bought in the last 7 days (`--bought-days`) - by `krs_paid` or by hand, as
   the crawl bucket's names say - so what was paid for reaches the site that
   night, or the night after a hand run or a held night. A page only: a page
   without a link is still bought by name, so a bought entry without a page
   is most likely a namesake's, and only tiers 1, 5 and 6 get a page;
3. a page the payload would change, on which somebody noted that data is
   missing ("Brakuje danych") and no admin has closed the entry - on the page
   itself, or on the page of a company the payload names: the night sends no
   company payloads, so what a company lacks comes up as its people's posts;
4. the same for any other note entry still open: a correction ("Do poprawy"),
   or an entry an admin marked unresolved;
5. at most 10 people the site has no page for whom only an odpis names, in a
   public post that has not ended and began before those 30 days
   (`--max-odpis-only-current`), created unpublished as in 1. 980 were waiting
   on 2026-10-11 and no night made a page for them; ten a night is Szymon's
   choice of that day - few enough to check by hand the next morning. The
   newest post first, and on one day a company the site has a page for first;
6. at most 50 more people the site has no page for, with a rejestr.io entry,
   in a public post - any post: a board, a supervisory seat, a prokurent - that
   has not ended and began before those 30 days (`--max-rejestrio-current`),
   created unpublished as in 1 and in the same order as 5. 13,518 were waiting
   on 2026-10-16, against 89 new hires, and no night made a page for any of
   them; fifty a night is Szymon's choice of that day;
7. a published page the payload would change;
8. any other page the payload would change.

Newest news first inside each. A payload sent unchanged in the last 30 days
is left alone (`--resend-after`), so a pending update or a party a human took
off a page does not take a slot every night - and is not put back every night.
That keeps the second tier to the week's purchases not yet sent: a bought
person whose payload went up unchanged is left alone like anybody else. And a
note nobody closes puts its page first only when there is something new to
send it.

Of all those pages, at most 100 that are published change a night
(`--max-published`), whichever tier sends them: the bought and the noted count
too. A change to a published page is what readers see, or a proposal waiting
for a reviewer, and a change to the code that builds the payloads can make many
of them read as changed at once. The cap keeps one night from leaving more to
review than can be reviewed (Szymon, 2026-10-15). The published pages past it
wait for the next nights, and the night goes on to the pages behind them. At
100 people a night it changes nothing - the nights of 2026-10-10 to 10-14
changed 45 to 87 published pages each, 33 to 49 of them bought or noted - and
it stays put when `--max-uploads` goes up.

Priority groups: between 4 and 5, the people in a post now at the companies
of a category, each group named in `KORYTA_NIGHTLY_ARGS` with a budget of its
own (Szymon, 2026-10-27 and 10-28):

    --priority-group skarb-panstwa:100:new=50

is up to 100 people a night with a post now at a company filed under Skarb
Państwa - one on Prokuratoria's list of the Treasury's stakes - at most 50 of
them new pages. A send for a group
takes nothing of the caps of 5, 6 and 7; only `--max-new`, every page the
night creates, is shared, and the night still sends `--max-uploads` in all, so
a group displaces the drafts in 8. Members past the budget go in their own
tier, as if there were no group. A group's members go only from 6 and 8: a
published page and somebody only an odpis names keep their caps. Any other
category the site offers makes a group too (`energetyka:50`, its public
companies); the flag repeats, and a person in two groups goes for the first. Each group's numbers are in the
people run's summary (`groups`, and `order` for the payloads part by position),
and each line of what was sent names its group.

On the night of 2026-10-28, replayed: 1,504 people held a post at one of the
Treasury's 317 companies, 981 of them waiting for a page, and the night sent
35, 17 of them new pages. With the group above it would have sent 103, 50
new, and 50 fewer drafts from 8; at 150 with new=100, 153, 100 new.

`--fill-rejestrio-current`: once 8 runs out - late November 2026 at 500 a
night - every tier left has a cap, and the night sends about 214 of its 500.
The flag gives the slots left to more people from 6, within `--max-new`;
never to published pages or to the people only an odpis names.

Companies: before the people go, the companies they name that tonight's export
has no page for are created, through `/api/ingest/company` from `Companies`
(`koryta_people_import --companies-only`, run with the people step's own
flags, so that it plans the same people). Until then the people step found
each such company only when the site took a person without the job there, and
created it and sent the person again: 27 companies on 2026-10-13, 16 on 10-14.
A company the step cannot create is the people step's to try again, which still
creates on the way what is missing; the summary of each run, with every company
and the people who name it, is in `jobs/company_import/runs/`, and the run on
/admin/procesy is „Import firm”.

And after the people, what tonight's data changes on the pages of the companies
the export has (`koryta_company_import`, step `company_updates`): a public
owner or founder found, sectors, the register's legal form and supervisory
organ, owner links and seats - what `CompaniesPayloads --only-changed` and a
hand upload used to send, and the night did not. 663 of the site's 10,674
companies were waiting on 2026-11-11. At most 200 a night
(`--max-company-uploads`), those turning public first. It holds back, and
names in its run's warnings for a hand upload, what each hand upload's reader
held back: a public company the payload would make private, the companies in
`HAND_ONLY` (`data/pipelines/src/jobs/company_import`), and one the site has
no page for under its KRS number. It keeps the name a page shows unless
`--max-company-renames` lets the register's in: 2 of the 3 renames waiting on
2026-11-11 were the pipelines' slips. Its runs report as „Import firm” too,
with what it sent in `jobs/company_import/payloads/`. `--company-dry-run`
builds and counts them and sends none.

Scores: after the people, every scoring model (`analysis/scores`) is rebuilt
and its shortlist reconciled with the votes it holds on the site - a changed
score written, one it no longer gives taken back (`koryta_score_import`). The
models rate the site's people as the 02:00 export has them and the pages the
people step has just created (`scrapers/koryta/created.py`, read from what the
import says it sent), so a new hire is in the queue on /eksploruj/nowe the same
morning rather than after the next export. A model that rates nobody is not
uploaded: reconciled, it would take back every vote it has.

Declarations: the people a declaration can publish, each in the stage they are
in, for the home page's tab, /oswiadczenia/postep and /admin/oswiadczenia. The
site counts them itself, from its own pages and readings and from what predator
did for each candidacy: the crawl, the cut and the upload run there by hand, and
after each it writes a facts part to
`gs://koryta-pl-sharedcache/jobs/bip_declarations/facts/`
(`koryta_bip_declarations facts-part`), with no names, dates or URLs in it. The
night's `declarations` step sends the newest part, with tonight's list and how
many Poles carry each surname (`koryta_bip_declarations send-facts`); the site
counts everybody then, and moves them between stages during the day as pages
are published or readings settle (decision on 2026-11-17).

News: the bulletin names a company whose entry changed, and the seats of
its people say what changed - somebody joined or left the management or the
supervisory board on the day of the entry. `NewsWatchChanges` (built by the
reprocess) lists those changes at the companies the site has a page for:
`PeopleKRSCombined`'s seats dated on, or up to three days before, a bulletin
day of their company (`KRSUpdates`), the companies off `KorytaNodes`. The
`news_watch` step (`koryta_news_watch`, `data/pipelines/src/jobs/news_watch`)
takes the changes of the bulletin days since yesterday and asks the news for
each person and company, `"<Imię Nazwisko>" "<company>"`, over the 14 days
either side of the change: the company by the name a reporter writes - no
legal form, no town - or by its town where the name is one every town has
("Przedsiębiorstwo Energetyki Cieplnej"). One query per person and company;
two changes whose windows overlap share one. At most `--news-max-queries`
(20) a night, and none asked in the step's last minute (`--max-minutes`);
0 switches the step off.

The searches: GDELT DOC 2.0, free and keyless, Polish sources only
(`sourcelang:polish`), one call every 30 seconds - its 429 asks for 5, but on
2026-11-26 calls 20 s apart, each answered in 10-20 s, drew a 429 on every
other query - and
the Brave Search news API once `BRAVE_SEARCH_API_KEY` is in the environment
(metered; its answers are not kept on disk, as its standard plans allow no
storing). Google News RSS is there by hand only (`--sources google_news`):
news.google.com's robots.txt disallows `/rss`, its feed says it is for
personal, non-commercial readers, and its links are Google's redirects, not
the publishers' URLs - so none of its hits is queued. Bing's Search API
(retired 2025-08-11) and Google's Custom Search JSON API (no new customers,
off on 2027-01-01) are not used. Every call says who asks
(`koryta-pipelines/<version> (https://github.com/SzymonPajzert/koryta)`), waits
at least a second after the source's last, and backs off on 429 and 5xx
(10, 20, 40 s). Each answer is kept under `versioned/news_watch/cache/<source>/day=<day>/`,
so a rerun the same day asks nothing again.

What it found goes to the crawl, which does the rest as for every page: each
URL in one spelling (https, no `www.`, no tracking parameters, no AMP), less
the articles the site has a page for, into the url store (`URL_STORE_URL`,
`source=news_watch`, with the person, the company and the queries as its
context), where the crawler's `--custom-pipeline` door fetches it and
`ArticleDoneUrls` reads it; `--queue postgres` puts them at the front of
predator's queue instead. Without `URL_STORE_URL` nothing is queued and the run
says so. The run's queries, candidates and summary are in
`versioned/news_watch/runs/<day>.jsonl`. A source that did not answer makes
the step partial (75); the next night asks for the next day's changes, so a
change whose search failed is searched again only by hand
(`koryta_news_watch --since <its bulletin day>`), which the cache makes cheap.

A failed step does not end the night; the steps that depend on it are held:

- `invariants` needs the export; `tests`, `outputs` and `news_watch` the
  reprocess, which builds the changes `news_watch` reads. `news_watch` holds
  nothing back.
- `people` needs tonight's export, a reprocess that succeeded, and checks with
  nothing new failing. "New" is against the last night that ran the check: a
  test that passed then and fails now - most likely after the last upload -
  holds the upload until somebody looks. The first night's failures are its
  baseline; on 2026-10-03, 18 invariants failed on budgets that had drifted
  past their measured values. A budgeted invariant fails only when it grows
  more than ten past its budget: up to that it passes with a warning
  (`within_budget` in `src/tests/pipelines/conftest.py`), which holds nothing
  and goes into the summary's `warnings` and onto the night's run. One that
  counts fewer than its budget passes too, and goes into the summary's `slack`
  and one log line ("3 budgets to lower: ..."), not onto the run.
- `scores` needs the same, but not the people: however they went, the scores
  go up, with whatever pages the people step did create.
- `companies` runs only when `people` may - skipped, not held, when it may
  not, so that a held night still names the people as what it held - and holds
  nothing back: the people go up however it went. `company_updates` the same,
  after the people: it neither waits for them nor holds the scores.
- `declarations` waits for nothing and holds nothing: a held night still moves
  the count. No part from predator yet, or no answer from the site - a 404
  included, before the site has the endpoint - is partial, and the next night
  sends again; a refusal, or the site's own error (500) again after a wait,
  fails the step. The site counts on every try, so there are two at most,
  which end inside the step's 15 minutes.
- `compute_nodes` waits for nothing and holds nothing: a held night still
  brings the counts and the search lines up to the day's edits. It is one
  request, which the site cuts off at 300 s; a refusal or no answer fails the
  step, and the counts stay as the last recount left them.

Recount: the stats every page carries - what the lists filter and sort by, the
queue tiers, the line the search box draws under a person - are worked out by
`/api/stats/computeNodes` over the whole database, last in the night so that
they cover everything it sent. It asks autopush, never koryta.pl (decision on
2026-11-18): the two share the database, and autopush runs main's code on
4000 MiB, while koryta.pl runs older code on 1 GiB, whose recount writes
`stats` without the search line and so takes it off every person. The robot
signs in as it does for its uploads: the site lets the datascience group
recount, as well as an admin.

## When the site runs on Postgres

The site moves its data to Postgres (docs/postgres/README.md). From the
cut-over Firestore takes no writes, so `scheduledFirestoreExport` would copy a
database nobody updates. Two steps change, and nothing else does:

| Step            | Firestore (today)                                                          | Postgres                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 02:00 export    | `scheduledFirestoreExport` to `gs://koryta-pl-crawled/hostname=koryta.pl/` | `npx tsx scripts/pg/export-jsonl.ts --out <dir>` on the site's side (a Cloud Scheduler job, or a Coolify scheduled task on `tools`), then copied |
| `export`        | waits for the newest folder with `.overall_export_metadata`               | with `KORYTA_EXPORT` set, waits for that export's `export.json`                                                                                   |
| `compute_nodes` | the site reads every document and writes every node (93-146 s at scale 1) | the same request: the site refreshes its views and writes the batch fields (15 s at scale 1)                                                     |

The export is `date=<ISO timestamp>/` with one `<collection>.jsonl.zst` per
collection the Firestore export takes, each line `{"id", "data"}`, read in one
snapshot, and `export.json` written last, with `exportedAt` and the rows of
each collection. 6 s and 14.6 MB at production's size. Copy it under a prefix
of its own, so that nothing reading the Firestore folders mistakes it for one:

```
DATABASE_URL=... npx tsx scripts/pg/export-jsonl.ts --out /tmp/export
gcloud storage cp -r "/tmp/export/date=<stamp>" gs://koryta-pl-crawled/hostname=koryta.pl-pg/
```

`KORYTA_EXPORT` in `nightly.env` (`gs://…/date=<stamp>`, a local path or an
`https://` URL) points every reader at it: `FirestoreCollection`, which the
people, votes, notes, facts and companies frames come from, and
`scrapers.koryta.snapshot`, which the invariants read. Same rows as from
Firestore's export, except that timestamps are ISO strings rather than
`datetime`, references such as `revision_id` are `revisions/<id>` paths
(`reference_id` reads both), and the `{"0": …}` maps the migration turned
back into lists are lists. Left unset, the night reads Firestore's export as
before. The stamp changes every night, so whatever writes the export also
writes the variable (or a fixed `…/latest` copy, which the export step then
reads once its `export.json` is there).

## Runs asked for on the site

The datascience group can ask, from a company's page or a person's, for what
the pipelines know about it to be sent now ("Wyślij dane osób",
"Wyślij dane tej osoby"). The site queues a run - a `jobRuns` document in the
ops database, `queued`, with the request in it - hands back its link,
`/admin/procesy#przebieg-<id>`, and starts this VM (`JOB_RUNNER_DISPATCH=vm`).
At every boot `koryta-requests.service` (`requests.sh`) runs
`koryta_job_requests --watch`, which:

- claims the queued runs one at a time, oldest first, and runs each as
  `koryta_people_import --request <id> --refresh none` - the night's outputs as
  they are on disk, the code the last night checked out. A company's run sends
  its people (pages for those the site lacks are created unpublished), a
  person's run that one person (it never creates a page);
- claims none before today's export is done: the job compares the page's
  people with it and refuses an older one. A run asked for between midnight
  and the export stays queued, its card on /admin/procesy saying it waits for
  the export, and goes once the export's `.overall_export_metadata` is there,
  with that export's stamp (`--export`) - at the 02:15 boot at the latest,
  before the night, which waits for it (the runs asked for from 2026-10-06 to
  10-11 took 0.3-5.6 minutes);
- takes `/var/lib/koryta-nightly/lock` for each run, as `night.sh` does for a
  night: a run waits for a night to finish, and a night started during a run
  waits for it (up to `KORYTA_LOCK_WAIT`, 30 min) instead of giving up;
- holds `requests.busy` while it has a run in hand, so the night's
  `poweroff.sh` leaves the VM up (as it does while one is queued) and the
  worker switches it off itself;
- once it has run something - or found every queued run waiting for the
  export - and nothing more comes for 10 minutes, writes
  `poweroff-requested` and exits, and `poweroff.sh requests` switches the VM
  off - never between 01:45 and 02:45 (the night is about to start), never
  while somebody is logged in or a night holds the lock, never with
  `/etc/koryta/stay-up`. A VM booted by hand, where it has run nothing and
  nothing waits, stays up as before;
- ends a run its job could not end (a crash, the ops database out of reach) by
  the job's exit code, and at start a run this host was doing when it went down.

Until the site may start the VM (task `grant-site-starts-nightly-vm`), a
request waits for the next night: the 02:15 boot starts the worker too, which
runs the queue once the export is done, or once the night lets go of the
lock if it has taken it first.

By hand on the VM: `journalctl -u koryta-requests -f`;
`sudo systemctl stop koryta-requests` keeps it from claiming anything.
`KORYTA_REQUESTS_ARGS` in `/etc/koryta/nightly.env` passes flags, e.g.
`--idle-minutes 30`.

## Setting it up

Once, as the project owner. `dev-workflow` cannot: it gets 403 on IAM, Compute
and Secret Manager.

1. Create the service account, its grants, the secrets, the VM and its
   schedule. Each step checks first, so a rerun carries on:

   ```bash
   bash data/nightly/create-vm.sh
   ```

   The PESEL key is added from the machine that holds it
   (`~/.config/koryta/pesel-salt`); the script says how if it is not that one.
   An existing secret is kept as it is: never add it a second version, as a
   new key's fingerprints join to nothing. The rejestr.io key comes from
   `REJESTR_KEY` (`REJESTR_KEY=... bash data/nightly/create-vm.sh`); without
   it the script prints the command that adds it later, and until then the
   night buys nothing. A new rejestr.io key can simply be added as a new
   version.

2. Prepare the VM - packages, the `koryta` user, uv, Go, the checkout, the
   units:

   ```bash
   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl \
     --command='sudo bash -s' < data/nightly/setup-vm.sh
   ```

   It sets up from `origin/main`. Before this is merged, name the branch -
   `--command='sudo env KORYTA_REF=origin/nightly-vm bash -s'` - and the
   nights run the branch until `KORYTA_REF` in `/etc/koryta/nightly.env` goes
   back to `origin/main`. Change it when the branch merges: once it is deleted,
   a night cannot check it out and stops at the start.

3. Run the first night by hand, sending nobody. It is a cold one - empty
   `versioned/`, empty download cache - so it takes longer than the rest.
   `--export-max-age 24` lets a daytime run take this morning's 02:00 export
   as tonight's. Only one taken within 6 h of the start counts otherwise, so
   a run started after 08:00 would wait 90 minutes for an export that comes
   tomorrow and then hold the people step:

   ```bash
   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl
   sudo systemd-run --unit=koryta-nightly-manual --uid=koryta --gid=koryta \
     --property=EnvironmentFile=/etc/koryta/nightly.env \
     --property=StateDirectory=koryta-nightly \
     /home/koryta/koryta/data/nightly/night.sh --force --people-dry-run \
       --export-max-age 24
   journalctl -u koryta-nightly-manual -f   # Ctrl-C leaves the night running
   ```

   The run is a service of its own, as the scheduled night is: a dropped SSH
   connection does not end it. (Not `--pty`: a hangup on its terminal would
   kill the night, which handles only SIGTERM.) To start it again after it
   ended, `sudo systemctl reset-failed koryta-nightly-manual` first.

   Then read the summary, and the log for the people step's plan
   ("Planned by tier", "The first 100 by tier"):

   ```bash
   gcloud storage cat "gs://koryta-pl-sharedcache/jobs/nightly/runs/date=$(TZ=Europe/Warsaw date +%F)/*.json"
   ```

4. The nights send up to 100 people from the start (`--max-uploads`). For
   nights that build and count them and send none, put
   `KORYTA_NIGHTLY_ARGS=--people-dry-run` in `/etc/koryta/nightly.env`.

Stop the VM afterwards, or leave it: the schedule boots it at 02:15 either
way, and the timer runs the night on a VM that is already up too.

## Day to day

- **How did last night go?** The row "Noc na maszynie koryta-nightly" on
  `/admin/procesy`; the jobs it ran report under their own names. The summary
  and the whole log are in `gs://koryta-pl-sharedcache/jobs/nightly/runs/` and
  `.../logs/`.
- **A warning on the night.** An invariant has grown past its budget, inside
  the ten it may grow before it fails and holds the upload; the summary's
  `warnings` name it with its count. Repair the data, or measure the count
  again and write it into the test with what grew it.
- **Budgets to lower.** An invariant counted fewer than its budget, so until
  the budget comes down it lets that many new cases in before it warns. The
  summary's `slack` names each with its count and known count, and the log
  says "N budgets to lower". Write the count into the test, with the export it
  was measured on. Nothing is held or warned for it. A lag allowance
  (`within_budget(count, RECOMPUTE_LAG, allowance=True)`, the few nodes a
  sweep can be behind) is not a budget and is never listed.
- **Log in during a night.** `sudo touch /etc/koryta/stay-up` before 02:30 and
  the VM stays up afterwards; remove it, or the VM runs - and bills - until
  the schedule's 07:00 stop. A boot outside the night window runs no night -
  only the requests worker, which does what is queued (above).
- **One step by hand.** `night.sh --force --only people --people-dry-run`
  (the `systemd-run` line above). Steps left out by `--only` or `--skip` hold
  nothing back. A real people run by hand creates pages no model has rated:
  add `--only scores`, or they wait for the next night.
- **Moving the night.** Four places move together, on the same day, or a
  night is lost: the export's `schedule` in `frontend/functions/src/index.ts`
  (deployed by hand: `firebase deploy --only functions:scheduledFirestoreExport`),
  the instance schedule (`gcloud compute resource-policies update
  instance-schedule koryta-nightly --region=europe-central2
  --vm-start-schedule=... --vm-stop-schedule=...`, or `create-vm.sh` again),
  the timer and the units (`setup-vm.sh` again: systemd reads its own copy, and
  night.sh runs the night before's copy of itself), and the hours in the code
  (`EXPORT_HOUR`, the window and `--stop-by` above, the worker's `--keep-up`,
  `jobs.ts` and `PEOPLE_IMPORT_WINDOW` on the site).
- **Other code.** `KORYTA_REF` in `/etc/koryta/nightly.env` - a tag holds the
  VM still while `main` moves. Every merge to `main` is otherwise live the
  next night.
- **More people.** `KORYTA_NIGHTLY_ARGS=--max-uploads 300`.
- **Fewer, or more, changes to published pages.**
  `KORYTA_NIGHTLY_ARGS=--max-published 50`; 0 changes none. It does not grow
  with `--max-uploads`: raise both for more of the published pages too.
- **More, or no, pages for the people only an odpis names in older posts.**
  `KORYTA_NIGHTLY_ARGS=--max-odpis-only-current 20`; 0 makes none. It does
  not grow with `--max-uploads`.
- **More, or no, pages for the people with a rejestr.io entry in older posts.**
  `KORYTA_NIGHTLY_ARGS=--max-rejestrio-current 100`; 0 makes none. It does
  not grow with `--max-uploads`, but comes out of it: on the 2026-10-16 data
  a night of 100 had room for 34 of them and for none of the unpublished
  pages behind them, a night of 150 for all 50 and 29 of those.
- **The private companies' odpisy too.** `KORYTA_NIGHTLY_ARGS=--odpis-missing all`;
  `public` leaves out the site's private ones, as before 2026-11-19, `none`
  the whole gap, as before 2026-10-09, and `--no-odpis-queue` the queue's
  companies, as before 2026-10-15.
- **More of the register.** `KORYTA_NIGHTLY_ARGS=--register-backlog 2000`.
  What it would read, without reading:
  `koryta_krs_register_owners --new-registrations --dry-run`.
- **More, or nothing, from rejestr.io.** `KORYTA_NIGHTLY_ARGS=--paid-max-calls 100`,
  or `0`. What a night bought is in
  `gs://koryta-pl-sharedcache/jobs/krs_scrape_paid/runs/`; what it would buy,
  without buying, `koryta_scrape_krs_paid --scope fallback --max-calls 50 --dry-run`.
- **A changed unit or timer.** Run `setup-vm.sh` again: systemd reads its own
  copies, not the checkout's.
- **Something broken in `versioned/`.** Delete the output; the next night
  restores it from the shared cache or rebuilds it.

## What it costs

At list prices in europe-central2: the VM, e2-highmem-4, is $0.218 an hour.
The first full night (2026-10-05, caches warm) took 110 minutes - 67 of them
the rebuild, 27 the pipeline tests - and peaked at 17.6 GB, so with the boot
about $13 a month. Its 30 GB balanced disk is $3.90 a month whether it runs
or not. Bucket traffic is under a dollar. The
shared cache grows by the night's backups as `main`; how long it keeps them is
`decide-sharedcache-backup-retention`. rejestr.io is at most 50 calls a night,
2.50 PLN; the first night's plan, on 2026-10-06's queue, was 12 calls.

## What it does not do

- rejestr.io for a company the free odpis has not been asked about: the
  night's `krs_odpis` asks for the bulletin's, then the queue's, then the
  public ones with no odpis on file, then the site's private ones, 300 in
  all, so a company waits its turn there; a private company with none that
  neither the queue nor the site names waits for `--odpis-missing all` or a
  hand run of `koryta_krs_odpis`.
- Companies: `CompaniesPayloads --only-changed` is not sent; a person's missing
  company is created on the way, as the uploader always did.
- `test_rejestrio_coverage.py`: it walks the whole rejestr.io prefix twice, an
  hour and a half - by hand only, as in CI.
- The article crawl.
- The BIP crawl (`koryta_scrape_bip`, by hand), nor the two pipelines that
  classify and parse what it fetched: they read its Postgres queue.
- The declarations' crawl, cut and upload: by hand on predator, which writes a
  facts part after each. The night only hands the newest to the site.

## Files

| File                      | What                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `create-vm.sh`            | the GCP side, once: service account, grants, secrets, VM, schedule              |
| `setup-vm.sh`             | the VM side, idempotent: packages, user, uv, Go, checkout, `/etc/koryta`, units |
| `koryta-nightly.timer`    | 02:30 Warsaw; catches up a missed start after boot                              |
| `koryta-nightly.service`  | runs `night.sh` as `koryta`, then `poweroff.sh` as root                         |
| `night.sh`                | night window, lock, checkout, venv, compressor, secrets, then `koryta_nightly`  |
| `koryta-requests.service` | at every boot: `requests.sh`, the worker for runs asked for on the site         |
| `requests.sh`             | the web key, then `koryta_job_requests --watch`                                 |
| `poweroff.sh`             | powers off after a night or an idle worker, unless `/etc/koryta/stay-up`        |
| `nightly.env.example`     | `/etc/koryta/nightly.env`'s first version                                       |
