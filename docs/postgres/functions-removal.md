# Wyłączenie Cloud Functions po przejściu na Postgresa

**Status:** plan, nie wdrożony. Część pakietu E (`docs/postgres/README.md`, „Pakiety portu”). Wykonać po scaleniu pakietów **B** (rewizje, publikacja, ingest) i **C** (głosy, notatki, `/api/me`), w oknie przełączenia z README („Plan przełączenia”, krok 4).

## Co dziś działa w `frontend/functions/src`

| Funkcja | Wyzwalacz | Co robi | Zastępstwo na Postgresie | Kto dostarcza |
|---|---|---|---|---|
| `onNodeWritten` | zapis `nodes/*` | `stats.isApproved` przy zmianie publikacji; `nameChunksLower` | `is_approved` to kolumna generowana, `node_stats.stats.isApproved` widok; `nameChunksLower` nie istnieje (wyszukiwarka na tsvector) | fundament, A |
| `onEdgeWritten` | zapis `edges/*` | znaczniki `edgeStatsDirty` (źródło) i `nodeContentDirty` (oba końce) | `node_target`/`node_stats` po `refresh_node_stats()`; `content_changed_at` obu końców w transakcji zapisu krawędzi | fundament, B |
| `sweepEdgeStats` | co minutę | przelicza `stats.edges` i pisze `content_changed_at` z obu znaczników | jak wyżej; tabel znaczników nie ma (`droppedCollections`) | fundament, B |
| `onRevisionWritten` | zapis `revisions/*` | `revisions{}` węzła (`computeRevisionsObj`), przy braku rewizji `revisions: null` (i węzeł-widmo bez typu) | `refresh_node_revisions(ARRAY[node_id])` w transakcji zapisu rewizji (0501_e); nocny `refresh_node_revisions()` naprawia resztę | E (funkcja), B (wywołanie) |
| `onVoteWritten` | zapis `votes/*` | `stats.votes` (`computeVoteStats`) | `node_stats` po `refresh_node_stats()` (debounce) | fundament, C |
| `onNoteWritten` | zapis `notes/*` | `stats.notesCount` (liczy dokumenty) | `node_stats` liczy źródła, jak `computeNodes` (01-inventory, rozbieżność 1) | fundament, C |
| `onFeedbackCreated` | utworzenie `feedback/*` | przekazanie do Slacka, z claimem dokumentu | po commicie w `POST /api/feedback/create`: zadanie w tle (`event.waitUntil`) z tym samym claimem przez `UPDATE … WHERE slack IS NULL RETURNING` | C |
| `scheduledFirestoreExport` | 02:00 | eksport do `gs://koryta-pl-crawled/hostname=koryta.pl/` | `scripts/pg/export-jsonl.ts` + `KORYTA_EXPORT` (data/nightly/README.md, „When the site runs on Postgres”) | E |
| `scheduledOpsTasksExport` | 04:20 | kopia bazy `agent-tasks` | to samo `export-jsonl.ts --all` dla schematu `ops` albo `pg_dump -n ops` do `koryta-pl-firestore-backups` | D/E |
| `getPageMeta` | `onCall` | metadane strony dla rozszerzenia | nie dotyka Firestore'a; zostaje albo przechodzi do `/api/page-meta` | poza zakresem |

`/api/stats/computeNodes` nie jest funkcją, ale należy do tej samej rodziny: na Postgresie to `recountBatch` (0501_e, `server/db/batch.ts`), 15 s zamiast 93–146 s.

## Warunki przed wyłączeniem

1. **B scalone:** każdy zapis węzła, krawędzi i rewizji idzie przez API do Postgresa i w tej samej transakcji:
   - woła `refresh_node_revisions(ARRAY[...])` dla węzłów z rewizją,
   - ustawia `content_changed_at` obu końców krawędzi,
   - zleca `refresh_node_stats()` (debounce, jeden na kilka sekund).
2. **C scalone:** głosy i notatki zapisuje `PUT /api/votes/*`, `PUT /api/notes/*`; przeglądarka nie pisze do Firestore'a (koniec VueFire). Feedback trafia do Slacka z API.
3. **Pipeline'y:** głosy modeli przez `ApiVotes` i `/api/votes/pipeline` (pakiet C, zrobione), ingest przez `/api/ingest/*` na Postgresie; noc czyta `KORYTA_EXPORT`.
4. **Zgodność:** `npm run test:parity` zielone, w tym `computeNodes.parity.test.ts` (pola wsadowe).

## Kolejność

Każdy krok osobno, z obserwacją jednego dnia między krokami:

1. **Zamrożenie zapisów do Firestore'a** (krok 4 planu przełączenia). Od tej chwili triggery nie mają czego obsługiwać. Gdyby coś jeszcze pisało, `onRevisionWritten` i `onNodeWritten` ujawnią to w logach. To sygnał błędu, nie powód do zostawienia funkcji.
2. **Usunięcie triggerów danych:** `onNodeWritten`, `onEdgeWritten`, `sweepEdgeStats`, `onRevisionWritten`, `onVoteWritten`, `onNoteWritten`.
   - `firebase functions:delete onNodeWritten onEdgeWritten sweepEdgeStats onRevisionWritten onVoteWritten onNoteWritten --region europe-west1`;
   - w kodzie: eksporty z `functions/src/index.ts` i pliki `nodes.ts`, `edges.ts`, `revisions.ts`, `votes.ts`, `notes.ts`;
   - dowiązania w `functions/src` (`model.ts`, `stats.ts`, `electionDays.ts`, `companyBodies.ts`, `companyOrgans.ts`, `slack.ts`, `qa.ts`) zostają tylko dla funkcji, które zostają.
3. **`onFeedbackCreated`** po tym, jak C przeniesie forward do API i przyjdzie pierwszy feedback z Postgresa na Slacka.
4. **Eksporty:** `scheduledFirestoreExport` po pierwszej nocy, która przeszła na `KORYTA_EXPORT` (krok `export` i `invariants` zielone). Ostatni eksport Firestore'a zostaje jako archiwum. `scheduledOpsTasksExport` po przeniesieniu `ops` (D).
5. **Sprzątanie:**
   - `firestore.indexes.json` i reguły do archiwum;
   - `functions/` usunięte z CI i `firebase.json` (zostaje `getPageMeta` albo cały katalog znika);
   - `edgeStatsDirty` i `nodeContentDirty` w Firestore usunięte razem z bazą.

## Ryzyka

- **`revisions: null` i węzły-widma.** Trigger przy ostatniej usuniętej rewizji tworzył węzeł bez typu (`set({revisions: null}, {merge: true})`). `refresh_node_revisions` aktualizuje tylko istniejące wiersze, więc widm nie tworzy. Migracja przenosi już istniejące: lista w raporcie `db:from-firestore` (węzły bez `type`).
- **`notesCount`** zmienia znaczenie z liczby notatek na liczbę źródeł, tak jak liczył `computeNodes`. Dziś trigger nadpisywał nocną wartość w ciągu dnia.
- **Opóźnienie statystyk.** Trigger działał w sekundach, `refresh_node_stats()` z debounce też, ale cały widok odświeża się 4,5–9 s przy skali produkcji. Przy serii zapisów (ingest) jedno odświeżenie na serię.
