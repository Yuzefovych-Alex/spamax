import Icon from './Icon';

const primaryLinks = [
  { label: 'Подключение Telegram', page: 'telegram', icon: 'mail' },
  { label: 'Уведомления', page: 'notifications', icon: 'chat' },
  { label: 'Журнал событий', page: 'logs', icon: 'pulse' },
];

function SidebarLink({ item, active, onClick }) {
  return (
    <button
      className={`sidebar-link${active ? ' is-active' : ''}${item.page ? '' : ' is-muted'}`}
      type="button"
      onClick={item.page ? onClick : undefined}
      aria-current={active ? 'page' : undefined}
      disabled={!item.page}
    >
      <Icon name={item.icon} size={16} />
      <span>{item.label}</span>
    </button>
  );
}

function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#home" aria-label="AXTelegram — главная">
        <span className="brand-mark" aria-hidden="true">
          <span>AX</span>
          <i />
        </span>
        <span className="brand-copy">
          <span className="brand-name"><span>AX</span>Telegram</span>
          <span className="brand-caption">TELEGRAM WORKSPACE</span>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="Главная навигация">
        {primaryLinks.map((item) => (
          <SidebarLink
            key={item.label}
            item={item}
            active={activePage === item.page}
            onClick={() => onNavigate(item.page)}
          />
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
