import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../api';

const favoritesStorageKey = 'telegramNotificationFavorites';

async function request(path, options) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Не удалось выполнить запрос.');
  }
  return result;
}

function accountName(account) {
  const name = [account.firstName, account.lastName].filter(Boolean).join(' ');
  return name || (account.username ? `@${account.username}` : account.phone);
}

function NotificationsPage({ onNavigate }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [messageMode, setMessageMode] = useState('own');
  const [favoriteSource, setFavoriteSource] = useState('telegram');
  const [favorites, setFavorites] = useState([]);
  const [telegramFavorites, setTelegramFavorites] = useState([]);
  const [telegramFavoriteId, setTelegramFavoriteId] = useState('');
  const [browserFavoriteMessage, setBrowserFavoriteMessage] = useState('');
  const [ownMessage, setOwnMessage] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingTelegramFavorites, setLoadingTelegramFavorites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState('5');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refreshAccounts = useCallback(async () => {
    try {
      const result = await request('/api/telegram/accounts');
      setAccounts(result.accounts);
      setError((currentError) => (
        currentError.startsWith('Не удалось загрузить список аккаунтов:')
          ? ''
          : currentError
      ));
    } catch (requestError) {
      setError(`Не удалось загрузить список аккаунтов: ${requestError.message}`);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    try {
      const savedFavorites = window.localStorage.getItem(favoritesStorageKey);
      if (savedFavorites === null) return;

      const parsedFavorites = JSON.parse(savedFavorites);
      if (!Array.isArray(parsedFavorites) || parsedFavorites.some((item) => typeof item !== 'string')) {
        throw new Error('Список обраних повідомлень має некоректний формат.');
      }
      setFavorites(parsedFavorites);
    } catch (requestError) {
      setError(`Не вдалося завантажити обрані повідомлення: ${requestError.message}`);
    }
  }, []);

  useEffect(() => {
    refreshAccounts();
    const timer = window.setInterval(refreshAccounts, 5000);
    window.addEventListener('focus', refreshAccounts);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshAccounts);
    };
  }, [refreshAccounts]);

  useEffect(() => {
    let active = true;
    const refreshSchedules = async () => {
      try {
        const result = await request('/api/telegram/schedules');
        if (active) setSchedules(result.schedules);
      } catch (requestError) {
        if (active) setError(`Не удалось загрузить расписания: ${requestError.message}`);
      }
    };
    refreshSchedules();
    const timer = window.setInterval(refreshSchedules, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const connectedAccounts = accounts.filter((account) => account.connected);
  const savedDisconnectedAccounts = accounts.filter((account) => !account.connected && account.hasSession);

  useEffect(() => {
    if (accountId && !accounts.some((account) => account.id === accountId && account.connected)) {
      setAccountId('');
      setGroups([]);
      setGroupId('');
    }
  }, [accountId, accounts]);

  useEffect(() => {
    if (!accountId) {
      setGroups([]);
      setGroupId('');
      setTelegramFavorites([]);
      setTelegramFavoriteId('');
      setLoadingTelegramFavorites(false);
      return undefined;
    }

    let active = true;
    setLoadingGroups(true);
    setLoadingTelegramFavorites(true);
    setGroups([]);
    setGroupId('');
    setTelegramFavorites([]);
    setTelegramFavoriteId('');
    setError('');
    setSuccess('');
    request(`/api/telegram/accounts/${accountId}/groups`)
      .then((result) => {
        if (active) setGroups(result.groups);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingGroups(false);
      });
    request(`/api/telegram/accounts/${accountId}/saved-messages`)
      .then((result) => {
        if (active) setTelegramFavorites(result.messages);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingTelegramFavorites(false);
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const selectedTelegramFavorite = telegramFavorites.find((item) => item.id === telegramFavoriteId);
  const message = messageMode === 'favorite'
    ? favoriteSource === 'telegram'
      ? selectedTelegramFavorite?.text || ''
      : browserFavoriteMessage
    : ownMessage;
  const scheduleMessages = messageMode === 'favorite'
    ? favoriteSource === 'telegram'
      ? telegramFavorites.map((favorite) => favorite.text)
      : favorites
    : [];

  const saveFavorite = () => {
    const text = ownMessage.trim();
    if (!text || favorites.includes(text)) return;
    const updatedFavorites = [...favorites, text];
    try {
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(updatedFavorites));
      setFavorites(updatedFavorites);
      setBrowserFavoriteMessage(text);
      setFavoriteSource('browser');
      setMessageMode('favorite');
      setError('');
      setSuccess('Повідомлення додано до обраного в цьому браузері.');
    } catch (requestError) {
      setError(`Не вдалося зберегти повідомлення в обраному: ${requestError.message}`);
    }
  };

  const removeFavorite = () => {
    const updatedFavorites = favorites.filter((item) => item !== browserFavoriteMessage);
    try {
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(updatedFavorites));
      setFavorites(updatedFavorites);
      setBrowserFavoriteMessage('');
      setError('');
      setSuccess('Повідомлення видалено з обраного.');
    } catch (requestError) {
      setError(`Не вдалося видалити повідомлення з обраного: ${requestError.message}`);
    }
  };

  const send = async (event) => {
    event.preventDefault();
    const group = groups.find((candidate) => candidate.id === groupId);
    const account = connectedAccounts.find((candidate) => candidate.id === accountId);
    if (!group || !account || !message.trim()) return;

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request('/api/telegram/send', {
        method: 'POST',
        body: JSON.stringify({ accountId, groupId, message }),
      });
      setSuccess(`Уведомление отправлено в группу «${result.groupTitle}».`);
      if (messageMode === 'own') setOwnMessage('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const addSchedule = async () => {
    const group = groups.find((candidate) => candidate.id === groupId);
    const account = connectedAccounts.find((candidate) => candidate.id === accountId);
    const intervalMinutes = Number(scheduleIntervalMinutes);
    if (!group || !account || scheduleMessages.length === 0) return;
    if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
      setError('Укажите интервал целым числом от 1 до 1440 минут.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request('/api/telegram/schedules', {
        method: 'POST',
        body: JSON.stringify({ accountId, groupId, messages: scheduleMessages, intervalMinutes }),
      });
      setSchedules((current) => [...current, result.schedule]);
      setSuccess(`Расписание добавлено. Нажмите «Запустить» в таблице, чтобы начать отправку.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const updateSchedule = async (scheduleId, action) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request(`/api/telegram/schedules/${scheduleId}/${action}`, { method: 'POST' });
      setSchedules((current) => current.map((schedule) => (
        schedule.id === scheduleId ? result.schedule : schedule
      )));
      setSuccess(action === 'start' ? 'Расписание запущено.' : 'Расписание остановлено.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSchedule = async (schedule) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request(`/api/telegram/schedules/${schedule.id}`, { method: 'DELETE' });
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      setSuccess('Расписание удалено.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const canSend = Boolean(accountId && groupId && message.trim() && !busy && !loadingGroups);

  return (
    <section className="telegram-page notification-page">
      <header className="telegram-page-header">
        <div>
          <p className="telegram-eyebrow">СООБЩЕНИЯ</p>
          <h1>Уведомления в группы</h1>
          <p className="telegram-subtitle">Отправляйте сообщения вручную или настройте отдельные расписания для разных аккаунтов и групп.</p>
        </div>
      </header>

      <form className="telegram-card notification-card" onSubmit={send}>
        <button
          className="telegram-button notification-form-toggle"
          type="button"
          aria-expanded={formOpen}
          aria-controls="notification-form-content"
          onClick={() => setFormOpen((isOpen) => !isOpen)}
        >
          {formOpen ? 'Скрыть форму' : 'Настроить уведомление'}
        </button>
        <div id="notification-form-content" hidden={!formOpen}>
        {formOpen && (
        <div className="notification-form-content">
        {loadingAccounts ? (
          <p className="telegram-progress" role="status">Загрузка подключённых аккаунтов…</p>
        ) : connectedAccounts.length === 0 ? (
          <div className="telegram-empty">
            <strong>
              {savedDisconnectedAccounts.length > 0
                ? 'Сохранённые аккаунты не подключены'
                : 'Нет подключённых аккаунтов'}
            </strong>
            <p>
              {savedDisconnectedAccounts.length > 0
                ? `Сессии ${savedDisconnectedAccounts.length} аккаунтов сохранены, но соединение с Telegram не активно. Переподключите аккаунт, чтобы он появился в списке отправителей.`
                : 'Подключите аккаунт Telegram на странице управления аккаунтами.'}
            </p>
            <div className="notification-empty-actions">
              <button
                className="telegram-button telegram-button-secondary"
                type="button"
                onClick={refreshAccounts}
                disabled={loadingAccounts}
              >
                {loadingAccounts ? 'Обновление…' : 'Обновить список'}
              </button>
              <button className="telegram-button" type="button" onClick={() => onNavigate('telegram')}>
                Перейти к аккаунтам
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="notification-account-picker-heading">
              <span>Подключённые аккаунты</span>
              <button
                className="telegram-text-button"
                type="button"
                onClick={refreshAccounts}
                disabled={loadingAccounts}
              >
                {loadingAccounts ? 'Обновление…' : 'Обновить'}
              </button>
            </div>
            <label className="notification-field">
              <span>Аккаунт отправителя</span>
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
                <option value="">Выберите аккаунт</option>
                {connectedAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountName(account)} · {account.phone}
                  </option>
                ))}
              </select>
            </label>

            <label className="notification-field">
              <span>Группа</span>
              <select
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setError('');
                  setSuccess('');
                }}
                disabled={!accountId || loadingGroups || groups.length === 0}
                required
              >
                <option value="">
                  {loadingGroups ? 'Загрузка групп…' : accountId ? 'Выберите группу' : 'Сначала выберите аккаунт'}
                </option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.title}</option>
                ))}
              </select>
              {accountId && !loadingGroups && groups.length === 0 && !error && (
                <small>У этого аккаунта не найдено доступных групп.</small>
              )}
            </label>

            <div className="notification-message-section">
              <span className="notification-section-label">Текст уведомления</span>
              <div className="notification-mode-switch" role="group" aria-label="Источник сообщения">
                <button
                  className={messageMode === 'favorite' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={messageMode === 'favorite'}
                  onClick={() => {
                    setMessageMode('favorite');
                    setError('');
                    setSuccess('');
                  }}
                >
                  Избранное
                </button>
                <button
                  className={messageMode === 'own' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={messageMode === 'own'}
                  onClick={() => {
                    setMessageMode('own');
                    setError('');
                    setSuccess('');
                  }}
                >
                  Свой текст
                </button>
              </div>

              {messageMode === 'favorite' ? (
                <>
                  <label className="notification-field">
                    <span>Источник избранных сообщений</span>
                    <select
                      value={favoriteSource}
                      onChange={(event) => {
                        setFavoriteSource(event.target.value);
                        setError('');
                        setSuccess('');
                      }}
                    >
                      <option value="telegram">Избранное в Telegram выбранного аккаунта</option>
                      <option value="browser">Избранное этого браузера</option>
                    </select>
                  </label>

                  {favoriteSource === 'telegram' ? (
                    loadingTelegramFavorites ? (
                      <p className="telegram-progress" role="status">Загрузка избранного из Telegram…</p>
                    ) : telegramFavorites.length > 0 ? (
                  <>
                    <label className="notification-field">
                      <span>Выберите сообщение из «Избранного» аккаунта</span>
                      <select
                        value={telegramFavoriteId}
                        onChange={(event) => {
                          setTelegramFavoriteId(event.target.value);
                          setError('');
                          setSuccess('');
                        }}
                        required
                      >
                        <option value="">Выберите сообщение</option>
                        {telegramFavorites.map((favorite) => (
                          <option key={favorite.id} value={favorite.id}>
                            {favorite.text.replace(/\s+/g, ' ').slice(0, 80)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedTelegramFavorite && (
                      <>
                        <label className="notification-field">
                          <span>Предпросмотр сообщения</span>
                          <textarea value={selectedTelegramFavorite.text} rows={7} readOnly />
                          <small>{selectedTelegramFavorite.text.length} / 4096 символов</small>
                        </label>
                      </>
                    )}
                  </>
                    ) : (
                      <div className="notification-favorites-empty">
                        <span>В «Избранном» этого аккаунта не найдено текстовых сообщений.</span>
                      </div>
                    )
                  ) : favorites.length > 0 ? (
                    <>
                      <label className="notification-field">
                        <span>Выберите сохранённое сообщение</span>
                        <select
                          value={browserFavoriteMessage}
                          onChange={(event) => {
                            setBrowserFavoriteMessage(event.target.value);
                            setError('');
                            setSuccess('');
                          }}
                          required
                        >
                          <option value="">Выберите сообщение</option>
                          {favorites.map((favorite) => (
                            <option key={favorite} value={favorite}>
                              {favorite.replace(/\s+/g, ' ').slice(0, 80)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {browserFavoriteMessage && (
                        <>
                          <label className="notification-field">
                            <span>Предпросмотр сообщения</span>
                            <textarea value={browserFavoriteMessage} rows={7} readOnly />
                            <small>{browserFavoriteMessage.length} / 4096 символов</small>
                          </label>
                          <button className="telegram-text-button notification-remove-favorite" type="button" onClick={removeFavorite}>
                            Удалить из избранного браузера
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="notification-favorites-empty">
                      <span>В избранном этого браузера пока нет сообщений.</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="notification-field">
                    <span>Ваше сообщение</span>
                    <textarea
                      value={ownMessage}
                      onChange={(event) => {
                        setOwnMessage(event.target.value);
                        setError('');
                        setSuccess('');
                      }}
                      maxLength={4096}
                      rows={7}
                      placeholder="Напишите текст уведомления…"
                      required
                    />
                    <small>{ownMessage.length} / 4096 символов</small>
                  </label>
                  <button
                    className="telegram-button telegram-button-secondary notification-save-favorite"
                    type="button"
                    onClick={saveFavorite}
                    disabled={!ownMessage.trim() || favorites.includes(ownMessage.trim())}
                  >
                    {favorites.includes(ownMessage.trim()) ? 'Уже в избранном' : 'Сохранить в избранное'}
                  </button>
                </>
              )}
            </div>

            <div className="notification-actions">
              <button className="telegram-button" type="submit" disabled={!canSend}>
                {busy ? 'Отправка…' : 'Отправить уведомление'}
              </button>
              <span>Одно сообщение в выбранную группу за одно нажатие.</span>
            </div>

            <div className="notification-schedule">
              <div>
                <strong>Новое расписание</strong>
                <label className="notification-field notification-interval-field">
                  <span>Интервал отправки (минуты)</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    value={scheduleIntervalMinutes}
                    onChange={(event) => setScheduleIntervalMinutes(event.target.value)}
                    aria-describedby="notification-interval-help"
                  />
                  <small id="notification-interval-help">От 1 минуты до 24 часов.</small>
                </label>
                <p>В расписание сохранится выбранный аккаунт, группа и до 100 текстовых сообщений из указанного избранного.</p>
                {scheduleMessages.length > 100 && (
                  <p role="alert">Для расписания можно использовать не более 100 избранных сообщений.</p>
                )}
              </div>
              <button
                className="telegram-button"
                type="button"
                onClick={addSchedule}
                disabled={busy || !accountId || !groupId || messageMode !== 'favorite' || scheduleMessages.length === 0 || scheduleMessages.length > 100 || !Number.isSafeInteger(Number(scheduleIntervalMinutes)) || Number(scheduleIntervalMinutes) < 1 || Number(scheduleIntervalMinutes) > 1440 || loadingGroups || loadingTelegramFavorites}
              >
                + Добавить расписание
              </button>
            </div>
          </>
        )}

        {error && <p className="telegram-error" role="alert">{error}</p>}
        {success && <p className="notification-success" role="status">{success}</p>}
        </div>
        )}
        </div>
      </form>

      <section className="notification-schedules-card" aria-labelledby="notification-schedules-title">
        <div className="notification-schedules-heading">
          <div>
            <h2 id="notification-schedules-title">Расписания отправки</h2>
            <p>Сохранённые строки остаются в таблице и возобновляются после перезапуска сервера.</p>
          </div>
          <span>{schedules.length}</span>
        </div>
        {schedules.length === 0 ? (
          <p className="notification-schedules-empty">Расписаний пока нет. Выберите аккаунт, группу и избранное выше, затем нажмите «Добавить расписание».</p>
        ) : (
          <div className="notification-schedules-table-wrap">
            <table className="notification-schedules-table">
              <thead>
                <tr>
                  <th>Аккаунт</th>
                  <th>Группа</th>
                  <th>Интервал</th>
                  <th>Сообщения</th>
                  <th>Состояние</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => {
                  const account = accounts.find((item) => item.id === schedule.accountId);
                  return (
                    <tr key={schedule.id}>
                      <td>{account ? `${accountName(account)} · ${account.phone}` : `${schedule.accountName} · ${schedule.accountPhone}`}</td>
                      <td>{schedule.groupTitle}</td>
                      <td>{schedule.intervalMinutes} мин.</td>
                      <td>{schedule.messageCount}</td>
                      <td>
                        <span className={`notification-schedule-status${schedule.running ? ' is-running' : ''}`}>
                          {schedule.running ? 'Работает' : 'Остановлено'}
                        </span>
                        {schedule.error && <small className="notification-schedule-error">{schedule.error}</small>}
                        {schedule.running && (
                          <small className="notification-schedule-meta">
                            Отправлено: {schedule.sentCount}; следующая: {new Date(schedule.nextSendAt).toLocaleString()}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="notification-schedule-row-actions">
                          <button
                            className="telegram-text-button"
                            type="button"
                            onClick={() => updateSchedule(schedule.id, schedule.running ? 'stop' : 'start')}
                            disabled={busy || (!schedule.running && !account?.connected)}
                          >
                            {schedule.running ? 'Остановить' : 'Запустить'}
                          </button>
                          <button
                            className="telegram-text-button notification-remove-favorite"
                            type="button"
                            onClick={() => removeSchedule(schedule)}
                            disabled={busy}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="telegram-security-note">
        <strong>Перед отправкой</strong>
        <p>Используйте эту форму только для групп, где вы администратор или получили разрешение публиковать уведомления.</p>
      </div>
    </section>
  );
}

export default NotificationsPage;
