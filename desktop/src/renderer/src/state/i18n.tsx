import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';

export type Lang = 'uz' | 'ru' | 'en';

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'uz', label: "O'zbekcha", flag: '🇺🇿' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

// Tarjimalar lug'ati. Kalit -> {uz, ru, en}
const DICT: Record<string, Record<Lang, string>> = {
  // Umumiy
  'app.subtitle': { uz: 'Terminal tizimga kirish', ru: 'Вход в терминал', en: 'Terminal sign-in' },
  'common.login': { uz: 'Login', ru: 'Логин', en: 'Login' },
  'common.password': { uz: 'Parol', ru: 'Пароль', en: 'Password' },
  'common.enter': { uz: 'Kirish', ru: 'Войти', en: 'Sign in' },
  'common.entering': { uz: 'Kirilmoqda...', ru: 'Вход...', en: 'Signing in...' },
  'common.save': { uz: 'Saqlash', ru: 'Сохранить', en: 'Save' },
  'common.saving': { uz: 'Saqlanmoqda...', ru: 'Сохранение...', en: 'Saving...' },
  'common.cancel': { uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' },
  'common.delete': { uz: "O'chirish", ru: 'Удалить', en: 'Delete' },
  'common.edit': { uz: 'Tahrirlash', ru: 'Изменить', en: 'Edit' },
  'common.add': { uz: "Qo'shish", ru: 'Добавить', en: 'Add' },
  'common.search': { uz: 'Qidiruv', ru: 'Поиск', en: 'Search' },
  'common.close': { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },
  'common.back': { uz: 'Ortga', ru: 'Назад', en: 'Back' },
  'common.loading': { uz: 'Yuklanmoqda...', ru: 'Загрузка...', en: 'Loading...' },
  'common.all': { uz: 'Barchasi', ru: 'Все', en: 'All' },
  'common.logout': { uz: 'Chiqish', ru: 'Выход', en: 'Log out' },
  'common.online': { uz: 'Ulangan', ru: 'В сети', en: 'Online' },
  'common.offline': { uz: 'Oflayn', ru: 'Не в сети', en: 'Offline' },
  'common.total': { uz: 'Jami', ru: 'Итого', en: 'Total' },
  'common.noData': { uz: "Ma'lumot yo'q", ru: 'Нет данных', en: 'No data' },
  'common.loadMore': { uz: 'Ko‘proq yuklash', ru: 'Загрузить ещё', en: 'Load more' },

  // Rollar
  'role.ofitsiant': { uz: 'Ofitsiant', ru: 'Официант', en: 'Waiter' },
  'role.oshpaz': { uz: 'Oshxona (KDS)', ru: 'Кухня (KDS)', en: 'Kitchen (KDS)' },
  'role.kassir': { uz: 'Kassa', ru: 'Касса', en: 'Cashier' },
  'role.administrator': { uz: 'Administrator', ru: 'Администратор', en: 'Administrator' },
  'role.direktor': { uz: 'Direktor', ru: 'Директор', en: 'Director' },
  'role.superadmin': { uz: 'Super Admin', ru: 'Супер-админ', en: 'Super Admin' },

  // Buyurtma holatlari
  'status.qabul_qilindi': { uz: 'Qabul qilindi', ru: 'Принят', en: 'Accepted' },
  'status.tayyorlanmoqda': { uz: 'Tayyorlanmoqda', ru: 'Готовится', en: 'Cooking' },
  'status.tayyor': { uz: 'Tayyor', ru: 'Готов', en: 'Ready' },
  'status.yopildi': { uz: 'Yopildi', ru: 'Закрыт', en: 'Closed' },

  // To'lov turlari
  'pay.naqd': { uz: 'Naqd', ru: 'Наличные', en: 'Cash' },
  'pay.karta': { uz: 'Karta', ru: 'Карта', en: 'Card' },
  'pay.qr': { uz: 'QR', ru: 'QR', en: 'QR' },

  // Ofitsiant
  'waiter.tables': { uz: 'Stollar', ru: 'Столы', en: 'Tables' },
  'waiter.myOrders': { uz: 'Mening buyurtmalarim', ru: 'Мои заказы', en: 'My orders' },
  'waiter.cart': { uz: 'Savat', ru: 'Корзина', en: 'Cart' },
  'waiter.send': { uz: 'Buyurtmani yuborish', ru: 'Отправить заказ', en: 'Send order' },
  'waiter.sending': { uz: 'Yuborilmoqda...', ru: 'Отправка...', en: 'Sending...' },

  // KDS
  'kds.active': { uz: 'Faol buyurtmalar', ru: 'Активные заказы', en: 'Active orders' },
  'kds.history': { uz: 'Tarix', ru: 'История', en: 'History' },

  // Kassa
  'cashier.discount': { uz: 'Chegirma (%)', ru: 'Скидка (%)', en: 'Discount (%)' },
  'cashier.serviceFee': { uz: 'Xizmat haqi (%)', ru: 'Сервисный сбор (%)', en: 'Service fee (%)' },
  'cashier.payType': { uz: "To'lov turi", ru: 'Тип оплаты', en: 'Payment type' },
  'cashier.pay': { uz: "To'lash va chek", ru: 'Оплатить и чек', en: 'Pay & receipt' },

  // Filtrlar
  'filter.date': { uz: 'Sana', ru: 'Дата', en: 'Date' },
  'filter.today': { uz: 'Bugun', ru: 'Сегодня', en: 'Today' },
  'filter.week': { uz: 'Hafta', ru: 'Неделя', en: 'Week' },
  'filter.month': { uz: 'Oy', ru: 'Месяц', en: 'Month' },
  'filter.waiter': { uz: 'Ofitsiant', ru: 'Официант', en: 'Waiter' },
  'filter.hall': { uz: 'Zal', ru: 'Зал', en: 'Hall' },
  'filter.status': { uz: 'Holat', ru: 'Статус', en: 'Status' },
  'filter.payType': { uz: "To'lov", ru: 'Оплата', en: 'Payment' },

  // Admin bo'limlari
  'admin.menu': { uz: 'Menyu', ru: 'Меню', en: 'Menu' },
  'admin.inventory': { uz: 'Sklad', ru: 'Склад', en: 'Inventory' },
  'admin.categories': { uz: 'Kategoriyalar', ru: 'Категории', en: 'Categories' },
  'admin.tables': { uz: 'Stollar', ru: 'Столы', en: 'Tables' },
  'admin.staff': { uz: 'Xodimlar', ru: 'Сотрудники', en: 'Staff' },
  'admin.roles': { uz: 'Rollar', ru: 'Роли', en: 'Roles' },
  'admin.receipts': { uz: 'Cheklar', ru: 'Чеки', en: 'Receipts' },
  'admin.devices': { uz: 'Qurilmalar', ru: 'Устройства', en: 'Devices' },
  'admin.terminals': { uz: 'Terminallar', ru: 'Терминалы', en: 'Terminals' },
  'admin.settings': { uz: 'Sozlamalar', ru: 'Настройки', en: 'Settings' },

  // Direktor
  'director.revenue': { uz: 'Tushum', ru: 'Выручка', en: 'Revenue' },
  'director.topItems': { uz: 'Eng ko‘p sotilgan taomlar', ru: 'Топ продаж', en: 'Top items' },
  'director.byWaiter': { uz: 'Ofitsiantlar bo‘yicha', ru: 'По официантам', en: 'By waiter' },
  'director.byPayment': { uz: 'To‘lov turlari bo‘yicha', ru: 'По типам оплаты', en: 'By payment type' },
  'director.ordersCount': { uz: 'Hisoblar soni', ru: 'Кол-во чеков', en: 'Orders count' },
  'director.avgCheck': { uz: 'O‘rtacha chek', ru: 'Средний чек', en: 'Avg check' },

  // Sahifa sarlavhalari
  'title.kds': { uz: 'Oshxona ekrani (KDS)', ru: 'Экран кухни (KDS)', en: 'Kitchen Display (KDS)' },
  'title.cashier': { uz: 'Kassa', ru: 'Касса', en: 'Cashier' },
  'title.admin': { uz: 'Administrator paneli', ru: 'Панель администратора', en: 'Admin panel' },
  'title.director': { uz: 'Direktor — hisobotlar', ru: 'Директор — отчёты', en: 'Director — reports' },

  // KDS / Kassa / Ofitsiant amallari
  'kds.noNew': { uz: 'Hozircha yangi buyurtma yo‘q', ru: 'Пока нет новых заказов', en: 'No new orders yet' },
  'kds.startCooking': { uz: 'Tayyorlashni boshlash', ru: 'Начать готовить', en: 'Start cooking' },
  'kds.ready': { uz: 'Tayyor', ru: 'Готово', en: 'Ready' },
  'cashier.openBills': { uz: 'Ochiq hisoblar', ru: 'Открытые счета', en: 'Open bills' },
  'cashier.noBills': { uz: 'Ochiq hisob yo‘q', ru: 'Нет открытых счетов', en: 'No open bills' },
  'cashier.selectBill': { uz: 'To‘lov uchun hisobni tanlang', ru: 'Выберите счёт для оплаты', en: 'Select a bill to pay' },
  'waiter.order': { uz: 'Buyurtma', ru: 'Заказ', en: 'Order' },
  'waiter.sendToKitchen': { uz: 'Oshxonaga yuborish', ru: 'Отправить на кухню', en: 'Send to kitchen' },
  'waiter.pickDish': { uz: 'Taom tanlang', ru: 'Выберите блюдо', en: 'Pick a dish' },
  'waiter.free': { uz: 'Bo‘sh', ru: 'Свободен', en: 'Free' },
  'waiter.busy': { uz: 'Band', ru: 'Занят', en: 'Busy' },
  'waiter.people': { uz: 'kishi', ru: 'чел.', en: 'seats' },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function readInitial(): Lang {
  const saved = localStorage.getItem('lang');
  return saved === 'ru' || saved === 'en' ? saved : 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    localStorage.setItem('lang', lang);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const t = (key: string, fallback?: string): string => {
    const entry = DICT[key];
    if (!entry) return fallback ?? key;
    return entry[lang] || entry.uz || fallback || key;
  };

  return (
    <Ctx.Provider value={{ lang, setLang: setLangState, t }}>
      {children}
    </Ctx.Provider>
  );
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n I18nProvider ichida ishlatilishi kerak');
  return ctx;
}
