/**
 * Options → Import and export (docs/plan.md §2.1 "Данные", §12 phase 6): a JSON backup of
 * everything, restoring it by merging, and word lists for Anki and spreadsheets.
 */
import { useState, type ChangeEvent } from 'react';
import {
  BACKUP_SECTIONS,
  MAX_IMPORT_ROWS,
  addSummaries,
  datedFileName,
  emptySummary,
  importRequests,
  readBackup,
  type BackupFile,
  type BackupReadError,
  type BackupSection,
  type SectionSummary,
} from '@/src/backup/format';
import type { WordExportFormat, WordExportScope } from '@/src/backup/word-export';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { saveTextFile } from '@/src/ui/download';

/** A backup holds at most a few tens of megabytes; anything larger isn't one. */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
/** JSON per import request, so a port message stays small (rows are also capped by count). */
const MAX_REQUEST_CHARS = 4_000_000;

const READ_ERRORS: Readonly<Record<BackupReadError | 'too-large' | 'unreadable', MessageKey>> = {
  'not-json': 'dataRestoreNotJson',
  'not-backup': 'dataRestoreNotBackup',
  'newer-version': 'dataRestoreNewer',
  'too-large': 'dataRestoreTooLarge',
  unreadable: 'dataRestoreUnreadable',
};

const SECTION_LABELS: Readonly<Record<BackupSection, MessageKey>> = {
  words: 'dataSectionWords',
  phrases: 'dataSectionPhrases',
  segRules: 'dataSectionSegRules',
  settings: 'dataSectionSettings',
  videos: 'dataSectionVideos',
  aiAnswers: 'dataSectionAiAnswers',
};

const formatDate = (iso: string | null): string => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(date)
    : t('dataUnknownDate');
};

function BackupExport({ client }: { client: Client }) {
  const [state, setState] = useState<
    | { state: 'idle' | 'busy' | 'error' }
    | { state: 'done'; name: string; words: number; phrases: number }
  >({ state: 'idle' });
  return (
    <div className="data__block" data-testid="phasa-data-export">
      <h3>{t('dataBackupTitle')}</h3>
      <p>{t('dataBackupText')}</p>
      <button
        type="button"
        className="phasa-button phasa-button--primary"
        disabled={state.state === 'busy'}
        onClick={() => {
          setState({ state: 'busy' });
          client.request('data/export', {}, { timeoutMs: 120_000 }).then(
            ({ backup }) => {
              const name = datedFileName('phasa-backup', 'json', new Date());
              saveTextFile(document, JSON.stringify(backup, null, 2), name, 'application/json');
              setState({
                state: 'done',
                name,
                words: backup.words.length,
                phrases: backup.phrases.length,
              });
            },
            () => setState({ state: 'error' }),
          );
        }}
      >
        {state.state === 'busy' ? t('dataWorking') : t('dataBackupButton')}
      </button>
      {state.state === 'done' && (
        <p className="data__result" role="status">
          {t('dataBackupSaved', [state.name, String(state.words), String(state.phrases)])}
        </p>
      )}
      {state.state === 'error' && <p className="page__error">{t('dataBackupFailed')}</p>}
    </div>
  );
}

type RestoreState =
  | { state: 'idle' }
  | { state: 'invalid'; error: MessageKey }
  | { state: 'ready'; name: string; file: BackupFile }
  | { state: 'busy'; name: string; file: BackupFile; done: number; total: number }
  | { state: 'done'; summaries: Partial<Record<BackupSection, SectionSummary>> }
  | { state: 'error'; name: string; file: BackupFile; done: number; total: number };

function SummaryLines({
  summaries,
}: {
  summaries: Partial<Record<BackupSection, SectionSummary>>;
}) {
  const skipped = Object.values(summaries).reduce((sum, s) => sum + s.skipped, 0);
  return (
    <div className="data__result" role="status" data-testid="phasa-data-restored">
      <p>{t('dataRestoreDone')}</p>
      <ul className="data__summary">
        {BACKUP_SECTIONS.flatMap((section) => {
          const summary = summaries[section];
          if (!summary || summary.added + summary.updated + summary.unchanged === 0) return [];
          return [
            <li key={section} data-section={section}>
              {t('dataRestoreSection', [
                t(SECTION_LABELS[section]),
                String(summary.added),
                String(summary.updated),
                String(summary.unchanged),
              ])}
            </li>,
          ];
        })}
      </ul>
      {skipped > 0 && <p className="account__notice">{t('dataRestoreSkipped', String(skipped))}</p>}
    </div>
  );
}

function BackupRestore({ client }: { client: Client }) {
  const [state, setState] = useState<RestoreState>({ state: 'idle' });
  const [withSettings, setWithSettings] = useState(true);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const chosen = input.files?.[0];
    // Cleared at once, so choosing the same file again (after a restore) is a change too; the
    // preview names the file.
    input.value = '';
    if (!chosen) return;
    if (chosen.size > MAX_BACKUP_BYTES) {
      setState({ state: 'invalid', error: READ_ERRORS['too-large'] });
      return;
    }
    chosen.text().then(
      (text) => {
        const read = readBackup(text);
        setState(
          read.ok
            ? { state: 'ready', name: chosen.name, file: read.file }
            : { state: 'invalid', error: READ_ERRORS[read.error] },
        );
      },
      () => setState({ state: 'invalid', error: READ_ERRORS.unreadable }),
    );
  };

  const restore = async (name: string, file: BackupFile) => {
    const requests = importRequests(file, {
      settings: withSettings,
      maxRows: MAX_IMPORT_ROWS,
      maxChars: MAX_REQUEST_CHARS,
    });
    const summaries: Partial<Record<BackupSection, SectionSummary>> = {};
    for (const [index, request] of requests.entries()) {
      setState({ state: 'busy', name, file, done: index, total: requests.length });
      try {
        const { summary } = await client.request('data/import', request, { timeoutMs: 120_000 });
        summaries[request.section] = addSummaries(
          summaries[request.section] ?? emptySummary(),
          summary,
        );
      } catch {
        setState({ state: 'error', name, file, done: index, total: requests.length });
        return;
      }
    }
    setState({ state: 'done', summaries });
  };

  const file = 'file' in state ? state.file : null;
  const counts = file
    ? [
        String(file.rows.words.length),
        String(file.rows.phrases.length),
        String(file.contexts),
        String(file.rows.segRules.length),
        String(file.rows.videos.length),
        String(file.rows.aiAnswers.length),
      ]
    : [];

  return (
    <div className="data__block" data-testid="phasa-data-restore">
      <h3>{t('dataRestoreTitle')}</h3>
      <p>{t('dataRestoreText')}</p>
      <input
        type="file"
        accept=".json,application/json"
        aria-label={t('dataRestoreFile')}
        disabled={state.state === 'busy'}
        onChange={onFile}
      />
      {state.state === 'invalid' && <p className="page__error">{t(state.error)}</p>}
      {file && 'name' in state && (
        <div className="data__preview" data-testid="phasa-data-preview">
          <p>
            {t('dataRestoreFrom', [state.name, formatDate(file.exportedAt)])}
            <br />
            {t('dataRestoreCounts', counts)}
          </p>
          {file.settings && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={withSettings}
                disabled={state.state === 'busy'}
                onChange={(event) => setWithSettings(event.target.checked)}
              />
              {t('dataRestoreSettings')}
            </label>
          )}
          <button
            type="button"
            className="phasa-button phasa-button--primary"
            disabled={state.state === 'busy'}
            onClick={() => void restore(state.name, file)}
          >
            {state.state === 'busy'
              ? t(
                  'dataRestoreProgress',
                  String(Math.round((100 * state.done) / Math.max(1, state.total))),
                )
              : t('dataRestoreButton')}
          </button>
          {state.state === 'error' && (
            <p className="page__error">
              {t('dataRestoreFailed', [String(state.done), String(state.total)])}
            </p>
          )}
        </div>
      )}
      {state.state === 'done' && <SummaryLines summaries={state.summaries} />}
    </div>
  );
}

const SCOPES: readonly { value: WordExportScope; label: MessageKey }[] = [
  { value: 'learning', label: 'dataScopeLearning' },
  { value: 'learning-known', label: 'dataScopeLearningKnown' },
  { value: 'all', label: 'dataScopeAll' },
];

function WordLists({ client }: { client: Client }) {
  const [scope, setScope] = useState<WordExportScope>('learning');
  const [state, setState] = useState<
    | { state: 'idle' | 'error' }
    | { state: 'busy'; format: WordExportFormat }
    | { state: 'done'; name: string; count: number }
    | { state: 'empty' }
  >({ state: 'idle' });

  const run = (format: WordExportFormat) => {
    setState({ state: 'busy', format });
    client.request('data/export-words', { format, scope }, { timeoutMs: 120_000 }).then(
      ({ text, count }) => {
        if (count === 0) {
          setState({ state: 'empty' });
          return;
        }
        const name =
          format === 'anki'
            ? datedFileName('phasa-anki', 'txt', new Date())
            : datedFileName('phasa-words', 'csv', new Date());
        saveTextFile(
          document,
          text,
          name,
          format === 'anki' ? 'text/tab-separated-values' : 'text/csv',
        );
        setState({ state: 'done', name, count });
      },
      () => setState({ state: 'error' }),
    );
  };

  return (
    <div className="data__block" data-testid="phasa-data-words">
      <h3>{t('dataWordsTitle')}</h3>
      <p>{t('dataWordsText')}</p>
      <div className="known__row">
        <label className="select">
          {t('dataScope')}
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as WordExportScope)}
          >
            {SCOPES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="known__row">
        <button
          type="button"
          className="phasa-button"
          disabled={state.state === 'busy'}
          onClick={() => run('anki')}
        >
          {state.state === 'busy' && state.format === 'anki'
            ? t('dataWorking')
            : t('dataAnkiButton')}
        </button>
        <button
          type="button"
          className="phasa-button"
          disabled={state.state === 'busy'}
          onClick={() => run('csv')}
        >
          {state.state === 'busy' && state.format === 'csv' ? t('dataWorking') : t('dataCsvButton')}
        </button>
      </div>
      <p className="prefs__hint">{t('dataAnkiHint')}</p>
      {state.state === 'done' && (
        <p className="data__result" role="status">
          {t('dataWordsSaved', [state.name, String(state.count)])}
        </p>
      )}
      {state.state === 'empty' && <p className="page__empty">{t('dataWordsEmpty')}</p>}
      {state.state === 'error' && <p className="page__error">{t('dataWordsFailed')}</p>}
    </div>
  );
}

export function Data({ client }: { client: Client }) {
  return (
    <section id="data" className="page__section data" data-testid="phasa-options-data">
      <h2>{t('optionsSectionData')}</h2>
      <BackupExport client={client} />
      <BackupRestore client={client} />
      <WordLists client={client} />
    </section>
  );
}
