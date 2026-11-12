'use client';

import { useState } from 'react';
import TelegramConnectionPage from './pages/TelegramConnectionPage';
import NotificationsPage from './pages/NotificationsPage';
import LogsPage from './pages/LogsPage';
import Sidebar from './components/Sidebar';

function App() {
  const [activePage, setActivePage] = useState('telegram');

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main-content">
        {activePage === 'notifications'
          ? <NotificationsPage onNavigate={setActivePage} />
          : activePage === 'logs'
            ? <LogsPage />
            : <TelegramConnectionPage />}
      </main>
    </div>
  );
}

export default App;
