import '../client/src/index.css';
import '../client/src/App.css';

export const metadata = {
  title: 'AXTelegram',
  description: 'Управление аккаунтами Telegram и уведомлениями',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
