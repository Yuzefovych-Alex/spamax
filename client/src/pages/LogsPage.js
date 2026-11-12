import { useCallback, useEffect, useMemo, useState } from 'react';

const filters = [
  { value: 'all', label: 'Все события' },
  { value: 'success', label: 'Успешные' },
  { value: 'info', label: 'События' },
  { value: 'error', label: 'Ошибки' },
];

async function requestLogs() {
  const response = await fetch('/api/telegram/logs?limit=500', {
    headers: { 'Content-Type': 'application/json' },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Не удалось загрузить журнал.');
  }
  return result.logs;
}

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp));
}

function levelLabel(level) {
  if (level === 'success') return 'Успешно';
  if (level === 'error') return 'Ошибка';
  return 'Событие';
}

function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const result = await requestLogs();
      setLogs(result);
      setUpdatedAt(Date.now());
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    return logs.filter((log) => {
      if (filter !== 'all' && log.level !== filter) return false;
      if (!query) return true;
      return [
        log.message,
        log.accountName,
        log.groupTitle,
        log.type,
      ].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query);
    });
  }, [filter, logs, search]);

  const errorCount = logs.filter((log) => log.level === 'error').length;
  const successCount = logs.filter((log) => log.level === 'success').length;

  return (
    <section className="activity-page">
      <header className="telegram-page-header">
        <div>
          <p className="telegram-eyebrow">СИСТЕМА</p>
          <h1>Журнал событий</h1>
          <p className="telegram-subtitle">История отправок, расписаний и подключений аккаунтов.</p>
        </div>
        <button className="telegram-button telegram-button-secondary activity-refresh" type="button" onClick={refresh} disabled={loading}>
          <span aria-hidden="true">↻</span>
          {loading ? 'Обновление…' : 'Обновить'}
        </button>
      </header>

      <div className="activity-stats" aria-label="Сводка журнала">
        <article className="activity-stat">
          <span className="activity-stat-icon">≋</span>
          <div><strong>{logs.length}</strong><span>Всего записей</span></div>
        </article>
        <article className="activity-stat">
          <span className="activity-stat-icon is-success">✓</span>
          <div><strong>{successCount}</strong><span>Успешно</span></div>
        </article>
        <article className="activity-stat">
          <span className="activity-stat-icon is-error">!</span>
          <div><strong>{errorCount}</strong><span>Ошибки</span></div>
        </article>
      </div>

      <section className="activity-panel" aria-label="Записи журнала">
        <div className="activity-toolbar">
          <div className="activity-filters" role="group" aria-label="Фильтр по типу">
            {filters.map((item) => (
              <button
                key={item.value}
                className={`activity-filter${filter === item.value ? ' is-active' : ''}`}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="activity-search">
            <span className="activity-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по событию, аккаунту или группе"
              aria-label="Поиск по журналу"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Очистить поиск">×</button>
            )}
          </label>
        </div>

        <div className="activity-list-heading">
          <span>Событие</span>
          <span>Аккаунт / чат</span>
          <span>Дата и время</span>
        </div>

        {error && <p className="activity-error" role="alert">{error}</p>}
        {loading && logs.length === 0 ? (
          <div className="activity-empty"><span className="activity-loading-mark">↻</span><strong>Загружаем журнал</strong></div>
        ) : filteredLogs.length === 0 ? (
          <div className="activity-empty">
            <span className="activity-empty-icon">≋</span>
            <strong>{logs.length === 0 ? 'Пока нет событий' : 'Ничего не найдено'}</strong>
            <p>{logs.length === 0 ? 'Здесь появятся записи после отправки сообщений и действий с аккаунтами или расписаниями.' : 'Измените фильтр или поисковый запрос.'}</p>
          </div>
        ) : (
          <div className="activity-entries">
            {filteredLogs.map((log) => (
              <article className="activity-entry" key={log.id}>
                <span className={`activity-level-icon is-${log.level}`} aria-hidden="true">
                  {log.level === 'success' ? '✓' : log.level === 'error' ? '!' : '·'}
                </span>
                <div className="activity-entry-main">
                  <div className="activity-entry-title">
                    <strong>{log.message}</strong>
                    <span className={`activity-badge is-${log.level}`}>{levelLabel(log.level)}</span>
                  </div>
                  <small>{log.type.split('.').join(' · ')}</small>
                </div>
                <div className="activity-entry-context">
                  <strong>{log.accountName || 'Система'}</strong>
                  <span>{log.groupTitle || '—'}</span>
                </div>
                <time className="activity-entry-time" dateTime={new Date(log.timestamp).toISOString()}>
                  {formatTimestamp(log.timestamp)}
                </time>
              </article>
            ))}
          </div>
        )}

        <footer className="activity-footer">
          <span>Показано {filteredLogs.length} из {logs.length} последних записей</span>
          <span>{updatedAt ? `Обновлено ${new Intl.DateTimeFormat('ru-RU', { timeStyle: 'medium' }).format(new Date(updatedAt))}` : 'Автообновление каждые 5 секунд'}</span>
        </footer>
      </section>
      <p className="activity-privacy-note">Тексты сообщений и коды входа не записываются. Журнал хранится локально на сервере.</p>
    </section>
  );
}

export default LogsPage;
