# Postgres jako magazyn koryta.pl

**Status:** przyjęte (decyzja z 2026-11-26), wdrożone w całości na gałęzi `pg-rewrite`: `postgres-full` (fundament `pg-base`, pakiety A–E, PKW z pakietu F) plus `stats-sql`, `pg-native-endpoints`, `pg-native-editorial`, `pg-native-ops` i nocny `nodeGroupSize` w aplikacji. Serwer nie ma już ścieżki Firestore'a, flag backendu ani magazynu w kształcie Firestore'a.
**Materiał wejściowy:** `local_artifacts/2026-11-26-audyt/results/pg-migration/` (inwentarz 33+4 kolekcji, katalog 124 handlerów, pomiary SQL) i `local_artifacts/pg-poc/`.

Oznaczenia: **[Z]** zmierzone na tej gałęzi, **[S]** szacunek.

## Decyzja

1. **Postgres jest jedynym źródłem prawdy dla wszystkich danych.** Firestore znika z serwera; zostaje tylko do jednorazowej migracji.
2. **Firebase zostaje wyłącznie do logowania.** Firebase Auth wydaje tokeny, serwer weryfikuje je `firebase-admin` (`server/utils/auth.ts`) na podstawie samego `projectId`. Claimy `admin` / `datascience` / `owner` zostają w Auth. W bazie trzymamy tylko `uid`.
3. **Nitro API jest jedynym, kto pisze.** Żadnych zapisów z przeglądarki, żadnego dostępu bazy z klienta. `firestore.rules` zamieniają się w autoryzację w handlerach (tabela niżej).
4. **Triggery Cloud Functions, sweep co minutę i `computeNodes` zamieniają się w SQL.** Pochodne `stats.*` trzymają tabele (`node_stats`, `node_target`, `place_ancestors`, `node_derived`, `node_categories`, `hospital_*`), które zapis odświeża dla dotkniętych węzłów w swojej transakcji, a nocny `recountBatch` w całości. To, co utrzymywał trigger przy zapisie, robi się w tej samej transakcji co zapis.
5. **Bez realtime.** Pięć nasłuchów VueFire obserwuje wyłącznie dane zalogowanego (01-inventory, „Nasłuchy”). Po przeniesieniu zapisów na API wystarcza odświeżenie po zapisie. Nie budujemy LISTEN/NOTIFY ani SSE.
6. **Lift and shift, nie przebudowa relacyjna** (decyzja z 2026-11-26). Jedna tabela na kolekcję: `id text`, `data jsonb`. Relacyjny DDL z audytu (`schema*.sql`) to materiał referencyjny, nie cel.

## Architektura

```
przeglądarka ──(token Firebase Auth)──► Nitro (Cloud Run / kontener)
                                          │  server/utils/auth.ts: verifyIdToken (sam projectId)
                                          │  server/db/client.ts: pula postgres.js
                                          ▼
                                       Postgres 17
                                          ├─ tabele kolekcji: id, data jsonb (+ kolumny generowane)
                                          ├─ node_stats, node_target, place_ancestors, node_derived (tabele pochodne)
                                          └─ schemat ops (agent-tasks)
pipeline'y (Python) ──► /api/ingest/* (token z claimem datascience)
```

### Schemat (`frontend/server/db/migrations/`)

- **`0001_collections.sql`**: 31 tabel w `public` i 4 w `ops`, każda `id text COLLATE "C" PRIMARY KEY, data jsonb NOT NULL, created_at, updated_at`.
  - `COLLATE "C"`, bo Firestore porządkuje `__name__` bajtowo; klucz główny obsługuje wtedy `ORDER BY id`.
  - Kolumny generowane (`STORED`) tylko dla pól, po których filtrują, łączą i sortują gorące ścieżki: `nodes.type/deleted/is_approved`, `edges.type/source/target/deleted/is_approved`, `revisions.node_id/update_time`, `votes.node_id/extraction_id/user_uid`, `notes.node_id/user_uid`, `extractions.person_node_id`.
  - Indeksy wyrażeniowe: GIN na `data->'parties'` (osoby) i `data->'categories'` (miejsca), B-tree na `krsNumber` i `teryt`.
  - `edgeStatsDirty` i `nodeContentDirty` nie mają tabel: to znaczniki sweepa, który zastępują widoki.
- **`0002_node_stats.sql`**: statystyki pochodne nad jsonb; od `0601_node_stats_tables.sql` to zwykłe tabele zamiast widoków zmaterializowanych.
  - `place_ancestors`: `transitiveTargets` z `computeNodes` (regiony miejsca i wszystkie spółki nad nim).
  - `node_target`: `stats.edges.{all,approved}.{targetNodeIds,currentlyEmployedTargetNodeIds}` jako wiersze `(node_id, target_id, in_approved, cur_all, cur_approved)`.
  - `node_stats`: reszta `stats` (isApproved, notesCount liczone ze źródeł, factsCount, votes z `models`/`humanCount`/`lastVotedAt`, edges.all/approved, `people` regionu), jako kolumny do filtrowania i jako gotowy `stats jsonb`.
  - Funkcje SQL kopiujące reguły z `shared/`: `js_date` (`new Date` w V8, z przepełnieniem dnia), `election_key` (`candidacyElection`), `names_supervisory_seat`, `is_current_post`. Testy pg (`tests/server/db/statsSql.pg.test.ts`) porównują wynik z TypeScriptem, z którego reguły pochodzą.
  - `refresh_node_stats()` przepisuje tabele tam, gdzie się zmieniły (z `ANALYZE` między krokami, `0607`); `refresh_node_stats_for(ids, wide)` robi to samo dla węzłów zapisu (`0601`–`0607`, z szpitalami `0603` i sektorami `0604`).
- **Pola wsadowe:** `stats.queueTier` i `revisions{}` zostają w dokumencie (`refresh_queue_tiers`, `refresh_node_revisions` z `0501_e_batch_fields.sql`, oba z opcjonalną listą id dla zapisu); `nodeGroupSize` i `searchLine` są w tabeli `node_derived` (`0602`). Serwowany dokument to `data` z `stats` nadpisanym częścią pochodną (`servedDoc` w `server/db/nodes.ts`).
- **Przy zapisie** (`server/db/writeEffects.ts`, w transakcji zapisu): `refresh_node_stats_for`, `refresh_queue_tiers`, `refresh_node_derived_for` dla tego, czego zapis dotknął (`touchedBy`).
- **Nocą** `server/db/batch.ts` (`recountBatch`): `refresh_node_stats()`, `refresh_queue_tiers()`, `refresh_node_revisions()`, `refresh_node_derived()` (`searchLine`), `nodeGroupSize` w `server/db/groupSizes.ts` (niżej) i na końcu spis bazy (`refresh_database_counts()`). Wołają go `/api/stats/computeNodes`, `scripts/pg/recount.ts` i `load-seed`. Nocny eksport i wyłączenie funkcji: `data/nightly/README.md`, `docs/postgres/functions-removal.md`.
- **`nodeGroupSize` nocą** (`server/db/groupSizes.ts`, decyzja z 2026-11-27, `0920`, `0921`): graf czytany z jednego snapshotu (`REPEATABLE READ READ ONLY`), gęste id liczone w SQL i binarny `COPY` par `int4` wprost do tablic typowanych, CSR w `SharedArrayBuffer`, przejścia na `worker_threads` (`NODE_GROUP_THREADS`, domyślnie min(4, CPU)), upsert zmienionych wierszy. Liczą się tylko krawędzie nieusunięte. [Z] x10: 3,1 s całość (odczyt 2,3 s, z czego 1,4 s to złączenie krawędzi z gęstymi id po stronie serwera), wobec 40 s dawnego `node_group_sizes()`.
  - Zapis przyrostowy (`write_node_group_sizes`) trzyma wspólną blokadę doradczą współdzieloną i stempluje wiersze numerem z `node_group_gen`. Job bierze swój numer i pisze pod tą samą blokadą na wyłączność i nie rusza wierszy ostemplowanych później, więc noc nie nadpisze świeższej wartości zapisu, który wszedł w trakcie przeliczenia.
  - `node_group_sizes()` i `group_links` zostały tylko jako wyrocznia testów (`tests/server/db/groupSizesOracle.ts`).

Migracje uruchamia `npm run db:migrate` (`scripts/pg/migrate.ts` → `server/db/migrate.ts`). Każdy plik raz, w transakcji, w kolejności nazw; stan w `schema_migrations`. Pliku migracji, który poszedł na produkcję, się nie edytuje; zmiana to nowy plik.

### Warstwa dostępu: postgres.js, nie Drizzle ani Kysely

- **Drizzle odpada**, bo walczy z jsonb. Przy tabelach `id + data` jego schemat w TS nic nie wnosi. Generowanie migracji z TS nie obejmuje funkcji i widoków, które stanowią połowę schematu. Zapytania i tak byłyby fragmentami `sql\`\``.
- **Kysely odpada z tego samego powodu w mniejszej skali.** Każdy warunek na `data->'stats'->...` to `sql` w builderze, a typy wyniku i tak trzeba podać ręcznie.
- **postgres.js** (`postgres@3.4.9`, zero zależności): tagged templates składają się z fragmentów (`sql\`... ${warunek}\``), parametry są zawsze bindowane, pula jest wbudowana, a jsonb przychodzi jako obiekt.
- **Typy end-to-end:** wejście waliduje zod (zapytania już dziś, dokumenty z `shared/documents.ts` przy zapisie), wynik ma typ podany w `sql<Row[]>`. Dokumenty z bazy są tym samym kształtem, który definiuje zod, bo każdy zapis przechodzi przez schemat.

Pula (`server/db/client.ts`):
- `max: 5` na instancję (`PG_POOL_MAX`). Przy 1 vCPU i współbieżności 80 Node i tak przetwarza wyniki po jednym, a 10 instancji × 5 mieści się w 100 połączeniach najmniejszego Cloud SQL.
- `idle_timeout` 30 s, `max_lifetime` 30 min.
- `plan_cache_mode = force_custom_plan`: plan generyczny po piątym wykonaniu sortował wszystkie 27 509 osób dla strony 10 [Z: 115 ms zamiast 4,5 ms].
- Plugin `server/plugins/postgres.ts` zamyka pulę na `close`.

### Typy dokumentów: zod → JSON Schema → pydantic

- `frontend/shared/documents.ts` to jedyna definicja kształtu dokumentów kolekcji rdzenia: węzły per typ (unia po `type`), krawędzie, rewizje, głosy, notatki, ekstrakcje.
  - API zod 4 (`zod/v4`, dostępne w zainstalowanym zod 3.25.76) dla natywnego `toJSONSchema`.
  - Obiekty luźne (`looseObject`): nieznane pole zostaje i jest raportowane, nie odrzucane.
- `npm run schemas` zapisuje `shared/documents/json/<kolekcja>.schema.json` oraz modele pydantic v2 w `data/pipelines/src/entities/documents/` (datamodel-code-generator 0.34.0 przez `uvx`, bez zmiany `uv.lock` pipeline'ów).
- `tests/shared/documents.test.ts` pilnuje, że JSON Schema w repo odpowiada schematom zod.
- **Zapis przez API:** `schema.parse` przed zapisem, 400 przy błędzie. **Migracja:** `safeParse`, raport, bez odrzucania.
- Typy w `shared/model.ts` zostają na czas przejścia. Ich zastąpienie typami z `z.infer` to pakiet E (niżej).

## Warstwa danych: jawny SQL, bez magazynu w kształcie Firestore'a

- **Rozstrzygnięte (decyzja z 2026-11-26): natywny Postgres.** Każdy handler czyta i pisze jawnym SQL w `server/db/<obszar>.ts`; nie ma flag `READ_BACKEND`/`WRITE_BACKEND`, gałęzi Firestore'a ani adaptera w kształcie API Firestore'a (dawny `server/db/docStore.ts`, usunięty na `pg-rewrite`). `firebase-admin` zostaje na serwerze wyłącznie do weryfikacji tokenów Auth.
- **Zapisy redakcyjne** biegną w `editorialTx` (`server/db/editorial.ts`): jedna transakcja na decyzję, w niej zapis, wiersze audytu i efekty dawnych triggerów (`afterWrites`). Rewizje, kolejka, publikacja, scalanie i rozdzielanie: `server/db/{revisionWrites,revisionQueue,nodeMerge}.ts`; deklaracje: `server/db/declaration*.ts`, `readingQueue.ts`; ingest: `server/db/{personIngest,ingestWrites,extractionIngest,articlePages,articles,articleEdges}.ts`; krawędzie: `edgeWrites.ts`, `edgeQueues.ts`; poczta i ops: `mail.ts`, `ops.ts`; aktywność: `activityFeed.ts`, `interactions.ts`. Reguły (co dokument posiada, którą rewizję przyjmuje publikacja krawędzi) zostają w `server/utils/*` jako czyste funkcje.
- **Wartości** w dokumentach: daty jako ISO 8601, bajty jako `{"$bytes": base64}`, tak jak zapisała je migracja. `set(…, {merge: true})` z Firestore'a to `jsonb_merge_deep` (`0910`).
- **Efekty triggerów w transakcji zapisu** (`server/db/writeEffects.ts`):
  - `onRevisionWritten`: podsumowanie `revisions` węzła przez `refresh_node_revisions(ids)`;
  - `onEdgeWritten` i sweep co minutę: `content_changed_at` na stronach zmienionych przez krawędź (`pagesChangedByEdgeWrite`);
  - `onNodeWritten`: `stats.isApproved` to `node_stats.is_approved`, a `nameChunksLower` zastępuje indeks wyszukiwarki (pakiet A);
  - statystyki pochodne dotkniętych węzłów (`refresh_node_stats_for`, `refresh_node_derived_for`) i `queueTier` (`refresh_queue_tiers(now(), ids)`). Nie ma odświeżania z opóźnieniem ani `REFRESH MATERIALIZED VIEW`: statystyki są aktualne w chwili commitu.
  - **Znane ryzyko:** przeniesienie krawędzi `seat`/`owns` poszerza odświeżenie (`wide`) na wszystkie firmy pod regionem źródłowym; [Z] przy x50 transakcja zapisu trwa wtedy ~110 s.
- **Testy:** pliki `tests/server/db/*.pg.test.ts` na prawdziwym Postgresie (każdy plik dostaje własną bazę, `pgHarness.ts`) i wzorzec HTTP `npm run test:golden` (`tests/golden/`). Testy zgodności z emulatorem Firestore'a (`tests/parity/`) usunięto razem z gałęzią Firestore'a; ich scenariusze pokrywają testy pg i wzorzec (`local_artifacts/2026-11-27-test-coverage/pg-rewrite-matrix.md`).

#### Pomiary pakietu B (historyczne)

Zmierzone dawnym `tests/parity/writes.parity.test.ts`, seed 0,1, emulator Firestore'a kontra Postgres 17 w Dockerze na tym samym Macu. [Z] Mediana na wywołanie, a dla ingestu suma 100 żądań:

| Operacja | Firestore (emulator) | Postgres |
|---|---|---|
| `POST /api/revisions/create` | 7,2 ms | 3,0 ms |
| `POST /api/revisions/approve` | 15,5 ms | 7,8 ms |
| `POST /api/nodes/publish` | 114,6 ms | 34,1 ms |
| `POST /api/edges/publish` | 20,4 ms | 4,7 ms |
| `POST /api/nodes/merge` | 115,7 ms | 16,8 ms |
| `POST /api/ingest/person` × 100 nowych osób | 42,4 s (424,7 ms/os.) | 2,10 s (19,0 ms/os.) |
| ten sam ingest drugi raz (nic nowego) | 14,7 s | 0,59 s |
| `GET /api/revisions/queue` | 128,8 ms | 57,0 ms |

Emulator to nie produkcja: wyszukiwanie imienników (`nameChunksLower array-contains-any`) skanuje w nim całą kolekcję, stąd 0,4 s na osobę. Liczby Postgresa obejmują transakcję, efekty triggerów i walidację zod. Zmierzone na magazynie pakietu B, przed przejściem na jawny SQL.

### Odczyty publiczne (pakiet A)

- Strona główna, tabela, karty i grafy czytają z Postgresa: `server/db/{edges,edgeLists,graph,search,stats,activity}.ts`, `fetchEdgesClose`/`fetchEdges`/`fetchNodesByIds` w `fetch.ts`.
- **Wyszukiwarka** (`0101_a_search.sql`): `pg_trgm`, funkcje SQL kopiujące `searchableText`/`splitQualifier`, trzy kolumny generowane na `nodes` z GIN trigram; chunk z `generateChunksLower` to indeksowany `LIKE`. 60/60 zapytań daje to samo co Firestore.
- **Statystyki** bez skanu i bez `nodeScan`: `progress` to jeden agregat nad tym samym `WHERE` co `/api/nodes` (`structuralFilters`); mapa to widok `region_people_rows`; szpitale `hospital_stats()` (`0603`); spis bazy `database_counts` z końca nocnego przeliczenia (`0606`).
- **Listy relacji** (`edgeLists.ts`, `0105_a_edge_lists.sql`) zachowują kolejność zapytań Firestore'a.

### Zapisy z klienta (pakiet C)

- Przeglądarka trzyma już tylko Firebase Auth. Głosy, notatki, `users/{uid}` i oceny QA idą przez API (`/api/votes/*`, `/api/notes/*`, `/api/me`, `/api/qa/checks`), a reguły z `firestore.rules` są w `server/utils/{voteRules,noteRules,meRules,qaChecks}.ts` (tabela niżej). Jawny SQL leży w `server/db/{votes,notes,users,feedback}.ts`, indeksy w `0301_c_user_activity.sql`.
- Pipeline'y wysyłają głosy modeli przez `ApiVotes` (`GET/POST /api/votes/pipeline`, nagłówki Cloudflare Access z `site_session`).
- Feedback zapisany na Postgresie nie trafia na Slacka (`onFeedbackCreated` to trigger Firestore'a). Do zrobienia w handlerze albo w jobie.

## Plan przełączenia

1. **Eksport.** `npm run db:pull` albo nocny eksport z `gs://koryta-pl-crawled/...`, wczytany do emulatora (`npm run emulators:prod-data`).
2. **Migracja:**
   ```
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 DATABASE_URL=… \
     npm run db:from-firestore -- --project koryta-pl --ops --report report.json
   ```
   Bez emulatora: ten sam skrypt z ADC i projektem `koryta-pl`.
   - Strumieniuje każdą kolekcję (`frontend/scripts/pg/fromFirestore.ts`; jedyny kod, który jeszcze czyta Firestore) i robi upsert partiami po 1000.
   - Wiersz zapisany tak jak dziś zostaje nietknięty, więc drugi przebieg pisze tylko różnice.
3. **Weryfikacja** (raport i kod wyjścia 0/2):
   - dla każdej kolekcji `count()` w Firestore = przeczytane = wiersze w PG;
   - 50 losowych dokumentów czytanych ponownie i porównanych z wierszem;
   - wiersze, których dokumentu już nie ma (`stale`; `--prune` usuwa);
   - dokumenty odrzucone przez schemat zod (ścieżki błędów);
   - nieznane kategorie;
   - każda poprawka kształtu z licznikiem;
   - każda wyzerowana data z wartością pierwotną.
4. **Okno zapisu.** Zamrożenie zapisów (tryb tylko do odczytu w API), ostatni przebieg migracji (różnicowy), `recountBatch` (`scripts/pg/recount.ts`), wdrożenie aplikacji na Postgresie, odmrożenie.
5. **Firestore** zostaje tylko do odczytu jako kopia, potem eksport archiwalny i wyłączenie.

**Kształty legacy, które migracja naprawia** (`server/db/normalize.ts`, wspólne dla migracji i loadera seeda):
- listy zapisane jako mapy `{"0": …}` w znanych polach list (`parties`, `categories`, `activity`, `references`, `member_parties`, `backing_parties`, `sources`, `stats.edges.*.{targetNodeIds,…}` i inne) zamieniane na tablice;
- `revision_id` jako `DocumentReference` / `{_path:{segments}}` zamieniany na ścieżkę `revisions/<id>` (to, co API zwraca już dziś);
- Timestamp i `{_seconds,_nanoseconds}` zamieniane na ISO 8601;
- Bytes na `{"$bytes": base64}`, GeoPoint na `{latitude, longitude}`;
- daty, których `new Date` nie czyta („2008-28-02”) w `birthDate`, `start_date`, `end_date`, zamieniane na `null` i liczone, z wartością w raporcie.
  - **Uwaga:** wyzerowane `end_date` zatrudnienia zmienia znaczenie z „nieczytelny koniec” (dziś: nie trwa) na „bez końca” (trwa). Lista z raportu idzie do przeglądu przed przełączeniem;
- `nameChunksLower` nie jest kopiowane; wyszukiwarka dostaje indeks w Postgresie (pakiet A).

## Konwencje portowania endpointu

Każdy port to jeden handler albo jedna rodzina, w osobnym commicie.

1. **Zapytanie w `server/db/<obszar>.ts`**, nie w handlerze. Jedna ścieżka: bez flag i bez gałęzi Firestore'a.
2. **SQL nad jsonb tłumaczy operatory Firestore'a 1:1:**

   | Firestore | Postgres |
   |---|---|
   | `where(f, "==", v)` | `data->'f' = to_jsonb(v)` albo kolumna generowana |
   | `array-contains` / `-any` | `data->'f' ? v` / `?| array[…]` (GIN) |
   | `in` | `= ANY(${textArray(x)}::text[])` (`server/db/textArray.ts`; `sql.array` w postgres.js 3.4.9 psuje pierwsze zapytanie połączenia: „malformed array literal”) |
   | `orderBy` | `ORDER BY …, id` w tym samym kierunku (Firestore dokłada `__name__` w kierunku ostatniego `orderBy`) |
   | `orderBy` na polu z `>=` | to pole sortuje przed `id` (`compared` w `listNodes`) |
   | `count()` | `count(*)` tym samym `WHERE` |
   | `offset/limit` | `LIMIT/OFFSET`; najpierw ids strony, potem dokumenty (CTE `page`) |
   | `getAll(ids)` | `WHERE id = ANY(...)` |
   | `doc.data()` z `stats` | `servedDoc`: `data` + `node_stats.stats` |

3. **Bez fallbacków w pamięci** i bez memo list. Brakujący indeks to nowa migracja z `CREATE INDEX`.
4. **Pochodne statystyki tylko z tabel pochodnych.** Endpoint, który zapisuje węzeł, krawędź, głos, notatkę albo ekstrakcję, robi to w `editorialTx` albo woła `afterWrites`/`refreshTouched` z `writeEffects.ts` w swojej transakcji. Nie liczymy statystyk w TS w handlerze ani nie zapisujemy ich do dokumentu.
5. **Zapis waliduje schemat** z `shared/documents.ts`. Kolekcja bez schematu dostaje go w tym samym porcie, razem z `npm run schemas`.
6. **Autoryzacja w handlerze** według tabeli reguł niżej. Uid zawsze z tokenu, nigdy z ciała.
7. **Testy:** `tests/server/db/<obszar>.pg.test.ts` na prawdziwym Postgresie (`openTestDatabase` z `pgHarness.ts`), z przypadkami dostępu (401/403), i krok we wzorcu `tests/golden/` dla nowego endpointu. Znana i zamierzona różnica jest nazwana w teście, nie wyciszona.
8. **Pomiar:** `scripts/pg/bench-nodes.ts` albo pomiar HTTP na skali 1, 10 i 50 (`seed-large`) dla gorących ścieżek. Liczby idą do commita.
9. **Komentarze** krótkie, decyzje z datą („decision on 2026-11-26”), zgodnie z CLAUDE.md. Zmiana widoczna dla użytkownika dostaje wpis w `shared/qa.ts`.

## `firestore.rules` → API

| Kolekcja | Reguła dziś | W API |
|---|---|---|
| `nodes` | odczyt opublikowanych | `is_approved` w każdym zapytaniu dla anonima (już w `listNodes`) |
| `notes` | odczyt: zalogowany albo nie-osoba; zapis: właściciel, id `nodeId_uid` | `GET /api/notes?nodeId=`, `PUT /api/notes/:nodeId` z uid z tokenu |
| `users/{uid}` | tylko właściciel, bez walidacji | `GET/PATCH /api/me`, zod z listą pól |
| `qaChecks` | zalogowany; id `itemId_uid` | `GET /api/qa/checks`, `PUT /api/qa/checks/:itemId` |
| `votes` | odczyt publiczny; zapis właściciel, -5..5, ≤40 kategorii | `PUT /api/votes/:target` (uid z tokenu, zod), `PUT /api/votes/pipeline` z `requireDatascience`; odczyt cudzych głosów do decyzji |
| `extractions`, `articlePages` | claim `datascience` | `requireDatascience` (już tak jest) |
| reszta, `agent-tasks` | nikt | tylko serwer; `ops` bez dostępu z zewnątrz |

Przepływ rewizji, publikacji i ingestu (pakiet B). Reguła klienta zawsze brzmiała „nikt”, a decyzje podejmowały handlery na Admin SDK. Port zostawia te same sprawdzenia w tych samych handlerach, dla obu backendów, i niczego nie otwiera:

| Reguła w `firestore.rules` | Endpointy | Sprawdzenie w API |
|---|---|---|
| `nodes`: `allow write: if false` (wkład czytelnika idzie przez rewizję) | `POST /api/revisions/create` (propozycja, także nowej strony) | `getUser`; uid z tokenu; pola przez `editSchemas` (bez `revision_id`, `published`, `stats`) |
| j.w.: o tym, co widzi publiczność, decyduje admin | `POST /api/revisions/{approve,reject}`, `/api/nodes/{publish,merge,split}`, `/api/edges/{publish,delete}`, `/api/topics/:id/approve` | `requireAdmin`; wpis w `audit` w tej samej transakcji |
| `revisions`: `allow read: if false; allow create: if false` | `GET /api/revisions/{queue,node,byNode,mine,pendingEdges,:id}`, `/api/nodes/{pending,revisions}`, `/api/edges/pending` | `getUser` (tylko zalogowani); `relations` i `/api/edges/unpublished` z `requireAdmin` |
| `edges`: brak `match` (domyślnie nikt) | `POST /api/edges/{create,update}`, `/api/edges/:id/references` | `getUser`; zapis admina od razu, reszta jako propozycja (`proposeRevisionTransaction`) |
| `extractions`, `articlePages`: tylko claim `datascience` | `POST /api/ingest/{person,company,page,extraction}` | `requireDatascience` na tokenie; przez Cloudflare Access z service tokenem (`cfAccess.ts`, bez zmian) |
| j.w. | `POST /api/ingest/article` | `getUser` (bez claimu, jak dziś; tworzy tylko szkic artykułu i `mentions`) |
| `audit`: brak `match` | każdy zapis wyżej | tylko serwer, `recordAudit` w batchu zapisu |

## Środowiska

- **Dev:** `docker compose up -d postgres` (`compose.yaml`, `postgres:17.7-bookworm`, użytkownik `postgres`).
  ```
  export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta
  npm run db:migrate
  npm run db:seed          # SEED_SCALE=1 dla rozmiaru produkcji
  npm run dev:local
  ```
  `db:seed` to `seed-large --out .data/seed` plus `scripts/pg/load-seed.ts`: dev, demo i benchmarki dostają te same deterministyczne dane co emulator.
- **Prodlike:** `compose.prodlike.yaml` ma `postgres` z 2 GiB i 1 CPU: `shared_buffers=512MB`, `effective_cache_size=1400MB`, `work_mem=32MB`, `log_temp_files=0`.
- **Testy pg:** `PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test npx vitest run tests/server/db/`; każdy plik zakłada własną bazę `koryta_test_<nazwa>`. Równoważność statystyk na załadowanym seedzie: `STATS_TEST_DATABASE_URL=… npx vitest run tests/server/db/statsSql.pg.test.ts`.
- **Wzorzec HTTP:** `npm run test:golden` przeciw buildowi produkcyjnemu na świeżym seedzie 0,1 (`tests/golden/README.md`, jeśli istnieje, i `scripts/golden/run.ts`).

## Demo na własnym serwerze / Coolify

Cel: prywatna instancja bez Firestore w czasie działania. Postgres w Dockerze plus produkcyjny build Nuxta; tożsamość z własnego projektu Firebase (plan Spark: Google + e-mail); dostęp przez Cloudflare Zero Trust.

**Pliki:**
- `compose.coolify.yaml`: zasób „Docker Compose” w Coolify.
- `docker/app/Dockerfile`, cele:
  - `app`: build produkcyjny, `USER node`, healthcheck przez Postgresa;
  - `tools`: migracje i loadery, `USER node`.

**Usługi:**
- `postgres`: `postgres:17.7-bookworm`, `user: postgres`, wolumen `pgdata`, healthcheck `pg_isready`.
  - Strojenie z env z domyślnymi wartościami dla współdzielonego hosta 64 GB: `PG_SHARED_BUFFERS=4GB`, `PG_EFFECTIVE_CACHE_SIZE=12GB`, `PG_WORK_MEM=64MB`, `PG_MAINTENANCE_WORK_MEM=1GB`, `PG_MAX_CONNECTIONS=100`, `PG_MEM_LIMIT=16g`, `PG_SHM_SIZE=1g`.
  - Profil 2 GiB do pomiarów „jak App Hosting” jest osobno, w `compose.prodlike.yaml`.
- `migrate`: jednorazowo przy każdym deployu, `scripts/pg/demo-init.ts`. Najpierw migracje, potem dane, ale tylko do pustej bazy (`SEED_FORCE=true` wymusza upsert):
  - `SEED_MODE=none` (domyślnie): sam schemat;
  - `SEED_MODE=seed`: syntetyczny seed w skali `SEED_SCALE`;
  - `SEED_MODE=public`: publiczna kopia koryta.pl (`nodes-*.jsonl.zst`, `edges.jsonl.zst` z `local_artifacts/dev-db/public/`) skopiowana na host do `SEED_PUBLIC_HOST_DIR`, uzupełniona syntetycznymi szkicami do skali produkcji.
- `app`: `depends_on: migrate: service_completed_successfully`, `expose: 3000`, bez portów hosta.
- `pipelines`: profil `pipelines`, nie startuje domyślnie (niżej).

**Kroki w Coolify:**
1. New Resource → Docker Compose → repozytorium, gałąź `postgres`, plik `compose.coolify.yaml`.
2. Usłudze `app` ustawić domenę (port 3000). Coolify ustawia `SERVICE_FQDN_APP_3000` i kieruje ruch przez swój Traefik. `SERVICE_PASSWORD_POSTGRES` Coolify generuje sam.
3. Zmienne zasobu:

   | Zmienna | Wartość |
   |---|---|
   | `NUXT_PUBLIC_VUEFIRE_CONFIG_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | konfiguracja web aplikacji z konsoli Firebase (placeholdery w pliku; wartości dostarcza właściciel projektu) |
   | `SEED_MODE`, `SEED_SCALE`, `SEED_PUBLIC_HOST_DIR` | dane startowe |
   | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | weryfikacja Cloudflare Access (niżej) |
   | `KORYTA_NOINDEX` | domyślnie `true` |

4. W Firebase Auth dodać domenę demo do „Authorized domains”. Włączyć dostawców Google i e-mail.
5. Deploy. `migrate` kończy się kodem 0, `app` przechodzi healthcheck (`/api/nodes?type=region&limit=1` przez Postgresa).

**Konfiguracja Firebase w czasie działania:**
- `nuxt.config.ts` zostawia obecne wartości jako domyślne (emulator w dev, `koryta-pl` w produkcji). Wdrożenie z innym projektem nadpisuje je zmiennymi `NUXT_PUBLIC_VUEFIRE_CONFIG_*`, bez przebudowy.
- Serwer inicjalizuje `firebase-admin` tym samym `projectId` (`server/plugins/firebase.server.ts`). Weryfikacja tokenu potrzebuje tylko kluczy publicznych Google, bez konta serwisowego.
- App Check jest wyłączony w buildzie demo (`FIREBASE_APP_CHECK=false`, argument builda), bo projekt Spark go nie ma.

**Prywatność i Cloudflare:**
- Host przyjmuje ruch tylko z zakresów IP Cloudflare (ustawione na hoście).
- Cloudflare Access wpuszcza listę e-maili.
- Automaty (skrypty, uploady pipeline'ów, CI, agent) używają **service tokenu** Access w nagłówkach `CF-Access-Client-Id` i `CF-Access-Client-Secret`:
  - pipeline'y: `CF_ACCESS_CLIENT_ID` i `CF_ACCESS_CLIENT_SECRET` w env. `data/pipelines/src/util/cf_access.py` dokłada je do każdego żądania uploadera do strony, i tylko do niego, nie do Google ani do źródeł;
  - skrypty frontendu: `scripts/siteHeaders.ts`, `KORYTA_URL` (np. `seed-large --recount`).
- **Druga linia obrony:** `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) i `CF_ACCESS_AUD` (Application Audience tag) włączają `server/middleware/cfAccess.ts`.
  - Każde żądanie bez ważnego `Cf-Access-Jwt-Assertion` dostaje 403: RS256, klucze z `/cdn-cgi/access/certs` z cache 1 h, sprawdzane `aud`, `iss` i `exp`.
  - Żądanie, które ominie Cloudflare przy źle ustawionym firewallu, też dostaje 403.
  - Przechodzi tylko loopback kontenera (healthcheck).
  - Sekrety tylko w zmiennych Coolify, nigdy w repo.
- `KORYTA_NOINDEX=true` (`server/middleware/noindex.ts`): `X-Robots-Tag: noindex, nofollow` na każdej odpowiedzi i `robots.txt` z `Disallow: /`.
- Sentry jest wyłączony (`SENTRY_ENABLED=false`; serwer włącza go tylko na Cloud Run).

**Obrazy:** `linux/amd64` przez `docker buildx build --platform linux/amd64`.
- `nuxt build` biegnie na platformie maszyny budującej (`--platform=$BUILDPLATFORM`). Pod emulacją amd64 na Macu Node działa bez JIT-a (`--no-opt` pod Rosettą) i build nie skończył się w godzinę [Z].
- Wynik to JavaScript z wyjątkiem binariów `sharp` i `better-sqlite3`. Etap `natives` instaluje je w tych samych wersjach dla platformy docelowej, podmienia w `.output/server/node_modules` i ładuje próbnie.
- `tools` instaluje zależności na platformie docelowej, bo `tsx` uruchamia binarny `esbuild`.
- `postgres.js` jest czystym JS.

**Pipeline'y na demo:**
- Usługa `pipelines` (profil) buduje `data/pipelines/Dockerfile`. Harmonogram: Coolify Scheduled Tasks na tym kontenerze. Uploady idą na publiczną domenę z service tokenem.
- **Czego brakuje:**
  - Po stronie zapisów nic: `/api/ingest/*` piszą do Postgresa, a głosy modeli idą przez `ApiVotes` i `/api/votes/pipeline` (pakiet C; `RestVotes` usunięte).
  - Obraz pipeline'ów działa jako root (`USER` w `data/pipelines/Dockerfile` niezrobiony).

## Co działa, co zostaje

**Na Postgresie:**
- `GET /api/nodes`: wszystkie filtry, oba rodzaje czytelników, ścieżka paginowana i cały typ;
- `fetchNodes` i przez nie każdy jego czytelnik;
- statystyki pochodne;
- migracja, loader seeda;
- odczyty publiczne: strona główna, tabela, karty, grafy, wyszukiwarka, statystyki, sitemapy (pakiet A);
- rewizje, publikacja, krawędzie, scalanie i rozdzielanie, ingest pipeline'ów (pakiet B), z efektami triggerów i odświeżeniem statystyk w transakcji zapisu;
- głosy, notatki, konto, QA, komentarze, feedback, aktywność (pakiet C);
- deklaracje, poczta przez SMTP, ops (pakiet D);
- pola wsadowe `computeNodes`, nocny eksport JSONL, regiony TERYT na demo (pakiet E);
- kandydatury PKW w `pkw_raw`/`pkw.candidacy` (pakiet F, `data/pipelines/src/jobs/pkw_postgres`).

**Zamierzone różnice zapisów wobec Firestore'a** (z czasów testów zgodności):
- `revisions` i `content_changed_at` na węzłach pisze Postgres w transakcji zapisu. Emulator nie uruchamia funkcji, więc po stronie Firestore'a ich brak.
- Daty zapisane przez API wychodzą jako ISO, nie jako Timestamp (jak w migracji).
- Zapis niezgodny ze schematem z `shared/documents.ts` dostaje 400; Firestore przyjmował wszystko. Data, której `new Date` nie czyta, zapisuje się jako `null` (`normalizeDocument`).

**Zamierzone różnice odczytów wobec Firestore'a:**
- `total` liczy wiersze, które strona serwuje. Indeksowana ścieżka Firestore'a liczy też scalone strony, które potem wyrzuca (`notMergedAway`): 19 z 2 766 osób na seedzie 0,1.
- `parties` bez pola liczy się jak `[]` dla `__NONE__`, tak jak w filtrze w pamięci. Indeksowany Firestore pyta o `== []`.
- Mapy z numerowanymi kluczami i Timestampy wychodzą jako tablice i ISO.
- Sortowanie po nieznanym polu idzie w porządku typów jsonb, nie Firestore'a; dokument bez pola nie wypada z listy.
- Remisy w sortowaniu mogą być rozbite inaczej niż w ścieżce pamięciowej Firestore'a. Indeksowana ścieżka rozbija je tak samo (`id` w kierunku sortu).

### Deklaracje, maile, ops (pakiet D)

- Publikacja, kolejka czytelników, decyzje admina, ingest wycinków i liczba osób: jawny SQL w `server/db/declaration*.ts` i `readingQueue.ts`; reguły w `shared/declarations.ts`, `shared/declarationPeople.ts` i czystych funkcjach `server/utils/declaration*.ts`. Publikacja strony idzie przez `editorialTx`, więc dostaje te same efekty triggerów i ten sam schemat przy zapisie co rewizje B.
- **Poczta:** tabela `mail` jest skrzynką nadawczą, `server/utils/mailOutbox.ts` wysyła ją przez SMTP (Nodemailer), z dzierżawą `FOR UPDATE SKIP LOCKED` na wiele instancji, trzema próbami i kształtem `delivery` rozszerzenia Trigger Email. Bez `MAIL_DRY_RUN=false` i `SMTP_HOST` nic nie wychodzi (transport JSON, `delivery.dryRun`). `MAIL_SEND_SINCE` (ISO, domyślnie start workera) odcina zaległość: rozszerzenie nigdy nie było zainstalowane i wszystko, co strona dotąd zakolejkowała, czeka jako `queued`. Zmienne: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_WORKER=false`, `MAIL_POLL_MS`; jednorazowo `scripts/mail/drain.ts`.
- **TTL:** `expire_documents()` (`0403_d_ops.sql`) usuwa co godzinę to, co minęło `expireAt` (`searchQueries`, niepotwierdzone zapisy na newsletter).

## Pakiety portu

Pięć pakietów na równoległych agentów, każdy od `pg-base`. Wszystkie są scalone w `postgres-full`; tabela zostaje jako mapa tego, kto czego dotknął. Ścieżki: `S/` = `frontend/server/`, `A/` = `frontend/app/`, `P/` = `data/pipelines/src/`.

| | Pakiet | Endpointy i pliki | Zależy od |
|---|---|---|---|
| **A** | **Odczyty publiczne i agregaty** | `S/api/stats/*` GET (`database`, `progress`, `homeTimeline`, `hospitals`, `regions`, `declaration_people`), `S/api/_sitemap-urls`, `S/api/search` (tsvector/trigram zamiast `nameChunksLower`; reguły z `shared/search.ts`), `S/api/graph/{local,topic,article}`, `S/api/nodes/[id]/*` GET, `S/api/nodes/articles/*`, `S/api/articles/*`, `S/api/edges/serviceMilestones`; w `S/utils/`: `fetch.ts` (`fetchEdges`, `fetchEdgesClose`, `fetchNodesByIds`), `nodeFilters.ts` dla `stats/progress`, `regionStats.ts`, `nodeScan.ts` (usunięty na `pg-rewrite`) | fundament |
| **B** | **Rewizje, publikacja, ingest** | `S/utils/{revisions,edges,edgePublication,audit,merge,provenance}.ts` jako transakcje SQL; `S/api/revisions/*`, `S/api/nodes/{publish,merge,split,…}.post`, `S/api/edges/*` POST, `S/api/topics/*`, `S/api/ingest/{person,company,article,page,extraction}`; schematy zod `audit`, `articlePages`; odświeżanie statystyk po zapisie. Po nim pipeline'y piszą na demo | fundament |
| **C** | **Zapisy z klienta i dane użytkownika** (faza 0 audytu) | `PUT /api/votes/:target` i `/api/votes/pipeline` (zamiast zapisów z `A/composables/votes.ts` i `P/util/firestore.py` `RestVotes`), `GET/PUT /api/notes`, `GET/PATCH /api/me` (`A/pages/profil.vue`, `A/composables/newsletter.ts`), `/api/qa/checks` (`A/composables/qa.ts`); odejście od VueFire (`A/composables/{auth,votes,notes}.ts`, `stats/useMyContributions.ts`, `A/pages/ekstrakcje/kategoryzacja.vue`); `S/api/{comments,feedback,interactions,activity,users}`, `S/utils/activityRollup.ts`, `qaReleases.ts`; schematy `users`, `qaChecks`, `comments`, `feedback*` | fundament; `refresh_node_stats` po głosie i notatce |
| **D** | **Deklaracje, maile, ops** | `S/utils/declaration*.ts` (`declarationPublish.ts` 2 152 linii), `S/api/declarations/**`, `S/api/ingest/declarations`; `S/utils/{mailCampaigns,mailTokens,newsletterSubscribers,notifications,mailAudience}.ts`, `S/api/{admin/mail,mail,newsletter}/*`; kolejka `mail`: worker SMTP zamiast rozszerzenia Trigger Email; `S/utils/{opsTasks,jobs,jobRequests}.ts`, `S/api/ops/**`, `S/api/search/log.post.ts` w schemacie `ops`; liczniki dzienne jako `UPDATE … RETURNING`; schematy zod tych kolekcji (część już jest w `shared/declarations.ts`, zod 3) | fundament; publikacja deklaracji używa rewizji z **B** |
| **E** | **Wsad, nocka, sprzątanie** | port pól wsadowych `computeNodes` (`nodeGroupSize`, `queueTier`, `searchLine`, `revisions{}`, `stats/region_people`) jako job piszący do `nodes.data.stats`; nocny eksport z PG (`pg_dump` do GCS) zamiast `scheduledFirestoreExport`; `P/scrapers/koryta/snapshot.py` czyta eksport PG/jsonl; wyłączenie triggerów `frontend/functions`; typy `shared/model.ts` z `z.infer` (`shared/documents.ts`); `USER` w `data/pipelines/Dockerfile` | fundament; usuwanie triggerów po **B** i **C** |
