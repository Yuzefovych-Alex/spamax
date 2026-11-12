import { useCallback, useEffect, useState } from 'react';

const initialData = { accounts: [], flow: null };
const challengeLabels = {
  phone: ['Номер телефона', 'Телефон в международном формате, например +79991234567'],
  code: ['Код Telegram', 'Введите код из Telegram или SMS'],
  password: ['Пароль двухэтапной проверки', 'Пароль 2FA вашего аккаунта'],
  email: ['Электронная почта', 'Адрес электронной почты, запрошенный Telegram'],
  email_code: ['Код из почты', 'Код подтверждения, отправленный Telegram на почту'],
};

async function request(path, options) {
  const response = await fetch(path, {
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

function TelegramConnectionPage() {
  const [data, setData] = useState(initialData);
  const [formMode, setFormMode] = useState(null);
  const [credentials, setCredentials] = useState({ apiId: '', apiHash: '', phoneNumber: '' });
  const [verificationValue, setVerificationValue] = useState('');
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await request('/api/telegram/accounts');
    setData(result);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    request('/api/telegram/accounts')
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active) setRequestError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!['connecting', 'verifying'].includes(data.flow?.status)) return undefined;
    let active = true;
    const timer = window.setInterval(() => {
      request('/api/telegram/accounts')
        .then((result) => {
          if (active) setData(result);
        })
        .catch((error) => {
          if (active) setRequestError(error.message);
        });
    }, 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [data.flow?.status]);

  const openAddForm = () => {
    setCredentials({ apiId: '', apiHash: '', phoneNumber: '' });
    setRequestError('');
    setFormMode({ type: 'add' });
  };

  const openReconnectForm = (account) => {
    if (account.hasSavedCredentials) {
      reconnectSavedAccount(account);
      return;
    }
    setCredentials({ apiId: String(account.apiId || ''), apiHash: '', phoneNumber: account.phone });
    setRequestError('');
    setFormMode({ type: 'reconnect', account });
  };

  const reconnectSavedAccount = async (account) => {
    setBusy(true);
    setRequestError('');
    try {
      const result = await request(`/api/telegram/accounts/${account.id}/reconnect`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setData(result);
      if (result.flow?.status !== 'error') setFormMode(null);
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async (event) => {
    event.preventDefault();
    setBusy(true);
    setRequestError('');
    try {
      const path = formMode.type === 'add'
        ? '/api/telegram/accounts'
        : `/api/telegram/accounts/${formMode.account.id}/reconnect`;
      const result = await request(path, {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      setData(result);
      setCredentials((current) => ({ ...current, apiHash: '' }));
      setVerificationValue('');
      if (result.flow?.status !== 'error') setFormMode(null);
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setRequestError('');
    try {
      await request('/api/telegram/verify', {
        method: 'POST',
        body: JSON.stringify({ value: verificationValue }),
      });
      setVerificationValue('');
      await refresh();
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelLogin = async () => {
    setBusy(true);
    setRequestError('');
    try {
      const result = await request('/api/telegram/cancel', { method: 'POST' });
      setData(result);
      setFormMode(null);
      setVerificationValue('');
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (account) => {
    setBusy(true);
    setRequestError('');
    try {
      const result = await request(`/api/telegram/accounts/${account.id}/disconnect`, { method: 'POST' });
      setData(result);
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account) => {
    setBusy(true);
    setRequestError('');
    try {
      const result = await request(`/api/telegram/accounts/${account.id}`, { method: 'DELETE' });
      setData(result);
      if (result.logoutConfirmed === false) {
        setRequestError('Сессия удалена с этого сервера, но Telegram не подтвердил выход. Проверьте раздел «Устройства» в приложении Telegram.');
      }
    } catch (error) {
      setRequestError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const flow = data.flow;
  const challenge = challengeLabels[flow?.step];
  const isPending = ['connecting', 'verifying'].includes(flow?.status);
  const formError = requestError || (flow?.status === 'error' ? flow.error : '');

  return (
    <section className="telegram-page">
      <header className="telegram-page-header">
        <div>
          <p className="telegram-eyebrow">АККАУНТЫ</p>
          <h1>Аккаунты Telegram</h1>
          <p className="telegram-subtitle">Подключайте несколько аккаунтов и управляйте их сессиями в одном месте.</p>
        </div>
        <button className="telegram-button" type="button" onClick={openAddForm} disabled={Boolean(flow) || busy}>
          + Добавить аккаунт
        </button>
      </header>

      <div className="telegram-accounts-summary">
        <strong>{data.accounts.length}</strong>
        <span>{data.accounts.length === 1 ? 'аккаунт сохранён' : 'аккаунтов сохранено'}</span>
        <span className="telegram-summary-connected">
          {data.accounts.filter((account) => account.connected).length} подключено
        </span>
      </div>

      {formMode && !flow && (
        <form className="telegram-card telegram-form-card" onSubmit={connect}>
          <div className="telegram-form-heading">
            <div>
              <h2>{formMode.type === 'add' ? 'Новый аккаунт' : `Подключение ${formMode.account.phone}`}</h2>
              <p>{formMode.type === 'add' ? 'Введите данные API с my.telegram.org и номер аккаунта.' : 'Для старого аккаунта введите API Hash один раз — он будет сохранён локально для автоматического подключения.'}</p>
            </div>
            <button className="telegram-text-button" type="button" onClick={() => setFormMode(null)} disabled={busy}>Закрыть</button>
          </div>
          <div className="telegram-form">
            <label>
              <span>API ID</span>
              <input required inputMode="numeric" autoComplete="off" value={credentials.apiId} onChange={(event) => setCredentials({ ...credentials, apiId: event.target.value })} placeholder="Например, 12345678" />
            </label>
            <label>
              <span>API Hash</span>
              <input required type="password" autoComplete="new-password" value={credentials.apiHash} onChange={(event) => setCredentials({ ...credentials, apiHash: event.target.value })} placeholder="32 символа" />
            </label>
            {formMode.type === 'add' && (
              <label>
                <span>Номер телефона</span>
                <input required type="tel" autoComplete="tel" value={credentials.phoneNumber} onChange={(event) => setCredentials({ ...credentials, phoneNumber: event.target.value })} placeholder="+79991234567" />
              </label>
            )}
            <div className="telegram-form-actions">
              <button className="telegram-button" type="submit" disabled={busy || isPending}>
                {busy || isPending ? 'Подключение…' : 'Продолжить'}
              </button>
              <span className="telegram-form-hint">Код входа придёт в Telegram или SMS.</span>
            </div>
            {formError && <p className="telegram-error" role="alert">{formError}</p>}
          </div>
        </form>
      )}

      {flow && (
        <div className="telegram-card telegram-challenge-card">
          <div className="telegram-form-heading">
            <div>
              <h2>{flow.phoneNumber || 'Подключение аккаунта'}</h2>
              <p>{flow.status === 'error' ? 'Не удалось выполнить вход.' : 'Подтвердите вход в Telegram.'}</p>
            </div>
            <button className="telegram-text-button" type="button" onClick={cancelLogin} disabled={busy}>
              Отменить
            </button>
          </div>
          {challenge && (
            <form className="telegram-challenge" onSubmit={verify}>
              <label>
                <span>{challenge[0]}</span>
                <small>{challenge[1]}</small>
                <input
                  autoComplete={flow.step === 'password' ? 'current-password' : 'one-time-code'}
                  type={flow.step === 'password' ? 'password' : 'text'}
                  value={verificationValue}
                  onChange={(event) => setVerificationValue(event.target.value)}
                  required
                  autoFocus
                />
              </label>
              <button className="telegram-button" type="submit" disabled={busy}>Подтвердить</button>
            </form>
          )}
          {isPending && <p className="telegram-progress" role="status">Ожидание ответа Telegram…</p>}
          {formError && <p className="telegram-error" role="alert">{formError}</p>}
        </div>
      )}

      {data.accounts.length > 0 ? (
        <div className="telegram-account-list">
          {data.accounts.map((account) => (
            <article className="telegram-account-card" key={account.id}>
              <span className={`telegram-account-avatar${account.connected ? ' is-connected' : ''}`}>
                {(account.firstName || account.username || account.phone || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="telegram-account-info">
                <strong>{accountName(account)}</strong>
                <span>{account.phone}{account.username ? ` · @${account.username}` : ''}</span>
              </div>
              <span className={`telegram-account-state${account.connected ? ' is-connected' : ''}`}>
                <i aria-hidden="true" />
                {account.connected ? 'Подключён' : account.hasSession ? 'Сессия сохранена' : 'Не подключён'}
              </span>
              <div className="telegram-account-actions">
                {account.connected ? (
                  <button className="telegram-button telegram-button-secondary" type="button" disabled={busy || Boolean(flow)} onClick={() => disconnect(account)}>
                    Отключить
                  </button>
                ) : (
                  <button className="telegram-button telegram-button-secondary" type="button" disabled={busy || Boolean(flow)} onClick={() => openReconnectForm(account)}>
                    Подключить
                  </button>
                )}
                <button className="telegram-text-button telegram-remove-button" type="button" disabled={busy || Boolean(flow)} onClick={() => remove(account)}>
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !formMode && !flow && (
          <div className="telegram-empty">
            <span className="telegram-empty-icon">+</span>
            <strong>Пока нет подключённых аккаунтов</strong>
            <p>Добавьте аккаунт Telegram — он появится здесь после подтверждения кода.</p>
            <button className="telegram-button" type="button" onClick={openAddForm}>Добавить первый аккаунт</button>
          </div>
        )
      )}

      {requestError && !formMode && !flow && <p className="telegram-error" role="alert">{requestError}</p>}

      <div className="telegram-security-note">
        <strong>Безопасность</strong>
        <p>
          API Hash и сессии аккаунтов сохраняются только локально в server/sessions/ с правами доступа
          владельца компьютера и используются для автоматического подключения. Не делитесь этой папкой.
        </p>
      </div>
    </section>
  );
}

export default TelegramConnectionPage;
