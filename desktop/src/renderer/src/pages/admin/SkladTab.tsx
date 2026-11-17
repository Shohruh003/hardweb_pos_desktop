// Sklad (ombor) — ixtiyoriy bo'lim. Bu fayl faqat qobiq: bo'limlar (Mahsulotlar / Harakatlar /
// Ta'minotchilar / Kirimlar), mahsulotlar ro'yxatini yuklash va oynalarni ochish. Har bir qism —
// ./sklad/* da. Mahsulot yo'q bo'lsa — Sklad nima qilishini tushuntiruvchi oyna (xato ham, ortiqcha
// tugma ham yo'q). Yozish (kirim, chiqim, inventarizatsiya…) — 'inventory' ruxsati yoki admin rollar;
// qolganlar faqat ko'radi (server ham shunday tekshiradi).
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCT_NOT_FOUND_MESSAGE, Product, SOCKET_EVENTS, productInRecipesMessage } from '@hardweb-pos/shared';
import { FeedbackModal, FeedbackVariant } from '../../components/FeedbackModal';
import { ErrorLine, Segmented } from '../../components/reports/parts';
import { api } from '../../lib/api';
import { loadPosSettings, refreshPosSettings } from '../../lib/posSettings';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../state/auth';
import { useConfirm } from '../../state/confirm';
import { ChiqimModal } from './sklad/ChiqimModal';
import { CountView } from './sklad/CountView';
import { KirimModal } from './sklad/KirimModal';
import { MovementsView } from './sklad/MovementsView';
import { ProductFormModal } from './sklad/ProductFormModal';
import { ProductionModal } from './sklad/ProductionModal';
import { ProductActions, ProductsView, SkladEmptyState } from './sklad/ProductsView';
import { PurchasesView } from './sklad/PurchasesView';
import { SuppliersView } from './sklad/SuppliersView';
import { VozvratModal } from './sklad/VozvratModal';
import { LoadingBlock } from './sklad/skladUi';
import { canDeleteSupplierPayment, canWriteSklad, errText } from './sklad/skladUtils';

type Section = 'products' | 'journal' | 'suppliers' | 'purchases';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'kirim'; id: string }
  | { kind: 'chiqim'; id: string }
  | { kind: 'vozvrat' }
  | { kind: 'production' };

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'products', label: '📦 Mahsulotlar' },
  { value: 'journal', label: '📜 Harakatlar' },
  { value: 'suppliers', label: '🚚 Ta’minotchilar' },
  { value: 'purchases', label: '🧾 Kirimlar' },
];

interface Notice {
  title: string;
  subtitle?: string;
  variant?: FeedbackVariant;
}

export function SkladTab() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const canWrite = canWriteSklad(user);
  const canDeletePayment = canDeleteSupplierPayment(user);

  const [section, setSection] = useState<Section>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasSuppliers, setHasSuppliers] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [counting, setCounting] = useState(false);
  const [journal, setJournal] = useState({ key: 0, productId: '' });
  const [flash, setFlash] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const seq = useRef(0);
  const flashTimer = useRef<number | undefined>(undefined);
  const deleting = useRef(false);

  // Mahsulotlar — eskirgan javob (keyinroq boshlangan so'rovdan oldin kelgan) qo'llanmaydi
  const loadProducts = useCallback(async () => {
    const my = ++seq.current;
    setRefreshing(true);
    try {
      const list = await api.get<Product[]>('/inventory/products');
      if (my !== seq.current) return;
      setProducts(Array.isArray(list) ? list : []);
      setLoadError('');
      // POS sozlamasidagi "Sklad ishlatiladimi" belgisi (vozvrat oynasi) — birinchi mahsulot qo'shilganda
      // yoki oxirgisi o'chirilganda shu terminalda darhol yangilansin
      const has = Array.isArray(list) && list.length > 0;
      void loadPosSettings()
        .then((p) => (p.skladEnabled !== has ? refreshPosSettings() : p))
        .catch(() => undefined);
    } catch (e) {
      if (my === seq.current) setLoadError(errText(e, 'Mahsulotlar yuklanmadi'));
    } finally {
      if (my === seq.current) {
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Sotuv (to'lov) qoldiqni kamaytiradi — chek yopilganda ro'yxatni jim yangilaymiz
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadProducts(), 800);
    };
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, refresh);
    socket.on('connect', refresh);
    return () => {
      window.clearTimeout(timer);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, refresh);
      socket.off('connect', refresh);
    };
  }, [loadProducts]);

  // Mahsulot yo'q, lekin ta'minotchilar (qarzlar) bor bo'lsa — bo'limlarga yo'l ochiq qolsin
  useEffect(() => {
    if (!loaded || loadError || products.length > 0) return;
    let alive = true;
    api
      .get<unknown[]>('/inventory/suppliers')
      .then((r) => {
        if (alive) setHasSuppliers(Array.isArray(r) && r.length > 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loaded, loadError, products.length]);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(''), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const showNotice = useCallback((title: string, subtitle: string) => setNotice({ title, subtitle }), []);

  const finish = useCallback(
    (message: string) => {
      setDialog(null);
      showFlash(message);
      void loadProducts();
    },
    [showFlash, loadProducts],
  );
  const closeDialog = useCallback(() => setDialog(null), []);

  const removeProduct = useCallback(
    async (p: Product) => {
      const used = Number(p.recipeCount) || 0;
      if (used > 0) {
        setNotice({ title: 'O‘chirib bo‘lmaydi', subtitle: productInRecipesMessage(used) });
        return;
      }
      if (deleting.current) return;
      const ok = await confirmRef.current({
        title: 'Mahsulotni o‘chirish',
        message: `«${p.name}» o‘chirilsinmi? Harakatlar jurnali va kirimlar tarixi saqlanib qoladi.`,
        confirmText: 'O‘chirish',
        danger: true,
      });
      if (!ok || deleting.current) return;
      deleting.current = true;
      try {
        await api.del(`/inventory/products/${p.id}`);
        showFlash(`«${p.name}» o‘chirildi`);
      } catch (e) {
        setNotice({ title: 'O‘chirilmadi', subtitle: errText(e) });
      } finally {
        deleting.current = false;
        void loadProducts();
      }
    },
    [showFlash, loadProducts],
  );

  const actions = useMemo<ProductActions>(
    () => ({
      onKirim: (p) => setDialog({ kind: 'kirim', id: p.id }),
      onChiqim: (p) => setDialog({ kind: 'chiqim', id: p.id }),
      onEdit: (p) => setDialog({ kind: 'edit', id: p.id }),
      onDelete: (p) => void removeProduct(p),
      onJournal: (p) => {
        setJournal((j) => ({ key: j.key + 1, productId: p.id }));
        setSection('journal');
      },
    }),
    [removeProduct],
  );

  // Oyna mahsuloti — doim ro'yxatdagi eng yangi holat (qoldiq jonli); boshqa joyda o'chirilsa — yopiladi
  const dialogId = dialog && 'id' in dialog ? dialog.id : null;
  const dialogProduct = dialogId ? products.find((p) => p.id === dialogId) : undefined;
  useEffect(() => {
    if (dialogId && loaded && !products.some((p) => p.id === dialogId)) {
      setDialog(null);
      setNotice({ title: PRODUCT_NOT_FOUND_MESSAGE, subtitle: 'Mahsulot boshqa joyda o‘chirilgan bo‘lishi mumkin.' });
    }
  }, [dialogId, loaded, products]);

  const countSaved = useCallback(
    (changed: number, entered: number) => {
      setCounting(false);
      setNotice({
        variant: 'success',
        title: 'Inventarizatsiya saqlandi',
        subtitle:
          changed > 0
            ? `${changed} ta mahsulot qoldig‘i to‘g‘rilandi (sanaldi: ${entered} ta).`
            : `Farq yo‘q — sanalgan ${entered} ta mahsulot qoldig‘i to‘g‘ri.`,
      });
      void loadProducts();
    },
    [loadProducts],
  );

  function pickSection(next: Section) {
    // "Harakatlar" yorlig'idan ochilsa — filtrsiz (mahsulot qatoridan ochilgandagi filtr qolib ketmasin)
    if (next === 'journal') setJournal((j) => ({ key: j.key + 1, productId: '' }));
    setSection(next);
  }

  const empty = loaded && !loadError && products.length === 0;
  const showTabs = loaded && !counting && (products.length > 0 || hasSuppliers || section !== 'products');

  let body: ReactNode;
  if (!loaded) {
    body = <LoadingBlock />;
  } else if (section === 'journal') {
    body = <MovementsView key={journal.key} products={products} initialProductId={journal.productId} />;
  } else if (section === 'suppliers') {
    body = <SuppliersView canWrite={canWrite} canDeletePayment={canDeletePayment} onFlash={showFlash} onNotice={showNotice} />;
  } else if (section === 'purchases') {
    body = <PurchasesView products={products} />;
  } else if (products.length === 0 && loadError) {
    body = <ErrorLine message={`Mahsulotlar yuklanmadi: ${loadError}`} onRetry={() => void loadProducts()} />;
  } else if (empty) {
    body = <SkladEmptyState canWrite={canWrite} onAdd={() => setDialog({ kind: 'create' })} />;
  } else if (counting && canWrite) {
    body = <CountView products={products} onCancel={() => setCounting(false)} onSaved={countSaved} />;
  } else {
    body = (
      <>
        {loadError && <ErrorLine message={`Ro‘yxat yangilanmadi: ${loadError}`} onRetry={() => void loadProducts()} />}
        <ProductsView
          products={products}
          canWrite={canWrite}
          refreshing={refreshing}
          onRefresh={() => void loadProducts()}
          onAdd={() => setDialog({ kind: 'create' })}
          onCount={() => setCounting(true)}
          onProduction={() => setDialog({ kind: 'production' })}
          onReturn={() => setDialog({ kind: 'vozvrat' })}
          actions={actions}
        />
      </>
    );
  }

  return (
    <div className="w-full" data-testid="sklad-tab">
      {showTabs && (
        <div className="mb-4">
          <Segmented<Section> options={SECTIONS} value={section} onChange={pickSection} testIdPrefix="sklad-tab" />
        </div>
      )}
      {flash && (
        <div role="status" data-testid="sklad-flash" className="mb-3 flex items-center gap-2 rounded-xl border border-success/60 bg-success/10 px-3 py-2.5 text-sm font-bold text-text">
          <span className="text-success text-base leading-none">✓</span> {flash}
        </div>
      )}
      {body}

      {canWrite && dialog?.kind === 'create' && <ProductFormModal products={products} onClose={closeDialog} onDone={finish} />}
      {canWrite && dialog?.kind === 'edit' && dialogProduct && (
        <ProductFormModal product={dialogProduct} products={products} onClose={closeDialog} onDone={finish} />
      )}
      {canWrite && dialog?.kind === 'kirim' && dialogProduct && <KirimModal product={dialogProduct} onClose={closeDialog} onDone={finish} />}
      {canWrite && dialog?.kind === 'chiqim' && dialogProduct && <ChiqimModal product={dialogProduct} onClose={closeDialog} onDone={finish} />}
      {canWrite && dialog?.kind === 'vozvrat' && <VozvratModal products={products} onClose={closeDialog} onDone={finish} />}
      {canWrite && dialog?.kind === 'production' && <ProductionModal products={products} onClose={closeDialog} onDone={finish} />}

      {notice && (
        <FeedbackModal variant={notice.variant ?? 'warning'} title={notice.title} subtitle={notice.subtitle} onClose={() => setNotice(null)} />
      )}
    </div>
  );
}
