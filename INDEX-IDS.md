# Index identifiers across builds

Status: **not fixed, guarded**. `tools/check-index-ids.js` (run by `npm test`)
fails when an Index id names another object than in the committed Index. The
naming itself is unchanged until one of the options below is chosen, because
each of them either changes ids people already hold or needs a decision about
what an old id meant.

## How an id is made

`tools/build-index.js` (`put`, around line 200) names a record `kind:name`,
the name the game shows. When a name is declared more than once in one kind
(a normal item and its Shiny, a portal reused by two dungeons), the **first
declaration met** takes the bare id and the others take `kind:name#clientId`
(`twin: true`, linked "same name as" to the bare one). Objects with the same
kind and type number are merged first, so `(kind, type)` is unique per record.

What is met first follows the `Objects.NNN.xml` files in name order, and
`tools/extract-client.js` numbers those files from the sorted **content** of
the documents. A content change in one build can renumber the files, so the
bare id moves to the other declaration. Two lookups inside build-index.js
(`records.get('item:' + name)`, near lines 716 and 863) resolve through the
bare id and move with it.

Measured on the committed Index (2,616 twin ids out of 21,018 records): from
36da5fd7 to 985af0d9 (builds f1f47983 to 730b86d6), five ids changed object:

| id | before | after | nature |
|---|---|---|---|
| `item:Spider Shuriken` | 0x460d (Shiny) | 0x3745 (normal) | twins swapped |
| `portal:Ocean Trench` | 0x730 | 0xbd02 | twins swapped |
| `enchant:Overwhelming Strikes` | `OVERWHEMLING_STRIKES` | `OVERWHELMING_STRIKES` | client id typo fixed by DECA |
| `enchant:Thankful` | `THANNKSGIVING_THANKFUL` | `THANKSGIVING_THANKFUL` | same |
| `enchant:Giver` | `THANNKSGIVING_GIVER` | `THANKSGIVING_GIVER` | same |

The two later updates (to 36be6a4a, then 6bae363a) moved no id.

## Who holds an id

- **Players' browsers**: Index favourites, `localStorage`
  `rotmg-tools/index-favourites` (`web/index-page.js`, `LOVED`), a plain list
  of ids.
- **Shared links**: `#index?open=<id>` (`web/router-contract.js`, `indexHash`).
- **wiki.json join**: `data/Index/wiki.json` is keyed by id and read by
  `tools/database/build_sqlite.py` (around line 190); its source bundle is not
  in the repository (ROT-B-10), so it cannot be rebuilt against new ids.
- **RealmEye enrichment** (`realmeye-enrichment.json`) and the frozen corpora
  under `tests/` are keyed by id too, but they are regenerated or re-recorded
  with each update.

## Options

1. **Freeze the owner of each bare id** (recommended). Commit a small table
   `data/Index/id-owners.json`, `{ "item:Spider Shuriken": "item|0x3745", ... }`,
   one line per twin name, written from the Index published today. `put`
   gives the bare id to the declaration the table names, whatever the file
   order; a new twin name is added to the table with a rule that does not
   depend on order (the declaration without a Shiny/variant suffix, else the
   smallest type). No id held today changes, so nothing has to migrate; the
   test is two builds fed the same objects in another file order, giving the
   same ids. Cost: one more file the scrape reads and updates, and a decision
   for ids whose object really disappears (keep the bare id free, or hand it
   on).
2. **Deterministic rule only** (the audit's first proposal): bare id to the
   declaration without Shiny/variant suffix, else the smallest type. Simple,
   no table, but it changes the bare id of every twin name whose owner today
   is not the one the rule picks, so it needs a one-off migration of the
   favourites list and old shared links, through an old-id to new-id table
   shipped with the site. Spider Shuriken already swapped once (3 Nov), so for
   the ids that moved before, nobody can tell which object an old favourite
   meant.
3. **Suffix every twin** (`kind:name#clientId` for all of them) and keep the
   bare id only as a search alias. Ids never move again, but every bare twin
   id held today stops opening a record: the largest migration.

Decisions for the owner of the project: which option; for option 1, what a
bare id becomes when its object leaves the client; whether old favourites on
the five ids above are left as they are (they open the object the id names
today).

## The guard in place

`node tools/check-index-ids.js` compares `HEAD:data/Index/index.json` with
the working copy, or two files given on the command line. An object is
`kind|type`, or `kind|clientId` when it has no type number (sets, pools,
enchantment lists, places); the file number is left out since it is the part
that moves. It exits 1 when an id names another object or is used twice, and
lists them. In the cloud update it runs with the other tests, after the
scrape, so a moved id shows in the pull request's failing tests.
`ROTMG_ACCEPT_ID_CHANGES=1` makes it a warning, for a move checked by hand
(the three enchantment typo fixes above would need it).

In CI (`.github/workflows/ci.yml`), once the moved ids have been checked by hand
(a season update, say): add the `accept-data-changes` label to the pull request,
which reruns the checks, or start the Tests workflow by hand with
`accept_data_changes` ticked. Both set `ROTMG_ACCEPT_ID_CHANGES=1` and
`ROTMG_ACCEPT_DATA_CHANGES=1`; the job log shows a "Data checks waived" warning
and still lists every change. The label only waives that pull request.

## Known limits (outside this work)

- **Two RealmEye archives (ROT-B-08).** The local archive
  (`local/realmeye-monitor/processed/realmeye.sqlite`) and the cloud release
  diverge, and `realmeye-enrichment.json` records only the archive's hash,
  not its date, so an export cannot tell that it reads an older archive. A
  large regression is still caught by `tools/check-data-drift.js` (archive
  pages, linked records), a small one is not. Fix to decide: record the
  archive date in the enrichment and refuse an older one, or fetch the
  release before any local scrape.
- **Name keys (ROT-B-17).** `name_key` (`build_sqlite.py`,
  `realmeye_archive_import.py`) drops non-ASCII letters and "+", so
  "Dōnotsura" cannot match "Donotsura" and "+Makakoyumi" collides with
  "Makakoyumi". Normalising with NFKD and keeping "+" as a marker would change
  which RealmEye pages join which records, so it needs a replay against the
  current archive before it is applied.
