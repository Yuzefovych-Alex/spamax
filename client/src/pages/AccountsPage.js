import { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import accounts from '../data/accounts';

const stats = [
  { value: '9110', label: 'Все аккаунты', active: true },
  { value: '15', label: 'Для работы' },
  { value: '11', label: 'Архив' },
  { value: '8402', label: 'Без ограничений' },
  { value: '708', label: 'С ограничениями' },
];

const filters = ['Роль', 'Гео', 'Отлежка', 'Статус', 'Папка'];
const columns = ['#', 'Телефон', 'Гео', 'Статус', 'Отлежка', 'Роль', 'Использован', 'Имя', 'Разное'];

function AccountsPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('');
  const [reverseSort, setReverseSort] = useState(false);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = accounts.filter((account) => {
      const matchesQuery = !normalizedQuery
        || `${account.phone} ${account.name} ${account.country} ${account.role}`.toLowerCase().includes(normalizedQuery);
      return matchesQuery
        && (country === 'all' || account.country === country)
        && (status === 'all' || account.status === status);
    });

    if (!sortBy) return filtered;
    return [...filtered].sort((a, b) => {
      const comparison = String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), 'ru');
      return reverseSort ? -comparison : comparison;
    });
  }, [country, query, sortBy, reverseSort, status]);

  const toggleAccount = (id) => {
    setSelected((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id]);
  };

  const toggleAll = () => {
    setSelected((current) => current.length === visibleAccounts.length
      ? []
      : visibleAccounts.map((account) => account.id));
  };

  const selectSort = (column) => {
    const field = { Телефон: 'phone', Гео: 'country', Статус: 'status', Роль: 'role', Имя: 'name' }[column];
    if (!field) return;
    if (sortBy === field) setReverseSort((current) => !current);
    else {
      setSortBy(field);
      setReverseSort(false);
    }
  };

  return (
    <section className="accounts-page">
      <div className="stats-grid">
        {stats.map((stat) => (
          <button className={`stat-card${stat.active ? ' stat-card-active' : ''}`} key={stat.label} type="button">
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </button>
        ))}
      </div>

      <div className="action-bar">
        <div className="action-buttons">
          <button className="icon-button" type="button" aria-label="Добавить аккаунт"><Icon name="plus" /></button>
          <button className="icon-button" type="button" aria-label="Открыть папки"><Icon name="folder" /></button>
          <button className="icon-button" type="button" aria-label="Обновить список" onClick={() => setQuery('')}><Icon name="refresh" /></button>
          <button className="icon-button" type="button" aria-label="Выбрать все" onClick={toggleAll}><Icon name="check" /></button>
          <button className="icon-button" type="button" aria-label="Снять выделение" onClick={() => setSelected([])}><Icon name="check" size={15} /></button>
        </div>
        <span className="account-count">Показано аккаунтов: {visibleAccounts.length} / 9110</span>
      </div>

      <div className="accounts-table-card">
        <div className="table-toolbar">
          <div className="filter-list">
            {filters.map((filter) => (
              <label className="filter-control" key={filter}>
                <span>{filter}</span>
                <Icon name="chevron" size={12} />
                <select
                  aria-label={filter}
                  value={filter === 'Гео' ? country : filter === 'Статус' ? status : 'all'}
                  onChange={(event) => {
                    if (filter === 'Гео') setCountry(event.target.value);
                    if (filter === 'Статус') setStatus(event.target.value);
                  }}
                  disabled={!['Гео', 'Статус'].includes(filter)}
                >
                  {filter === 'Гео' ? (
                    <>
                      <option value="all">Все гео</option>
                      <option value="RU">RU</option>
                      <option value="VN">VN</option>
                      <option value="US">US</option>
                    </>
                  ) : filter === 'Статус' ? (
                    <>
                      <option value="all">Все статусы</option>
                      <option value="Без ограничений">Без ограничений</option>
                      <option value="Заморожен">Заморожен</option>
                      <option value="Вечный спамблок">Вечный спамблок</option>
                    </>
                  ) : <option value="all">Все</option>}
                </select>
              </label>
            ))}
            <button className="icon-button filter-more" type="button" aria-label="Другие фильтры"><Icon name="more" /></button>
          </div>
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Поиск..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="table-scroll">
          <table className="accounts-table">
            <thead>
              <tr>
                <th className="checkbox-cell"><input aria-label="Выбрать все аккаунты" type="checkbox" checked={visibleAccounts.length > 0 && selected.length === visibleAccounts.length} onChange={toggleAll} /></th>
                {columns.map((column) => (
                  <th key={column} onClick={() => selectSort(column)} className={['Телефон', 'Гео', 'Статус', 'Роль', 'Имя'].includes(column) ? 'sortable' : ''}>
                    {column}
                    {['Гео', 'Статус', 'Роль', 'Использован', 'Имя'].includes(column) && <span className="sort-hint">↕</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map((account, index) => (
                <tr key={account.id}>
                  <td className="checkbox-cell"><input aria-label={`Выбрать аккаунт ${account.phone}`} type="checkbox" checked={selected.includes(account.id)} onChange={() => toggleAccount(account.id)} /></td>
                  <td className="row-number">{index + 1}</td>
                  <td className="phone-cell">
                    <span className={`avatar avatar-${account.color}`}>{account.avatar}</span>
                    <span>{account.phone}</span>
                  </td>
                  <td><span className="country-cell">{account.flag} {account.country}</span></td>
                  <td><span className={`status-pill${account.status === 'Заморожен' ? ' status-frozen' : account.status === 'Вечный спамблок' ? ' status-blocked' : ''}`}>{account.status}</span></td>
                  <td>{account.age}</td>
                  <td>{account.role}</td>
                  <td>{account.used}</td>
                  <td className="name-cell">{account.name}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" aria-label="Папка"><Icon name="folder" size={15} /></button>
                      <button type="button" aria-label="Контакт">@</button>
                      <button type="button" aria-label="Подробнее"><Icon name="info" size={15} /></button>
                      <button type="button" aria-label="Открыть аккаунт"><Icon name="external" size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleAccounts.length === 0 && (
                <tr><td className="empty-row" colSpan={10}>Аккаунты не найдены</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default AccountsPage;
