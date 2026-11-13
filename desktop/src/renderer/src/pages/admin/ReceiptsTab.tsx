import { CheckHistory } from '../../components/OrderHistory';

// Cheklar tarixi (B25) — admin "Cheklar" bo'limi va kassadagi "Cheklar" tugmasi shu yerni ochadi.
// Barcha filtrlar, yig'indi, cheksiz aylantirish, chek tafsiloti, qayta chop etish va vozvrat —
// yagona komponentda (components/OrderHistory.tsx → CheckHistory).
export function ReceiptsTab() {
  return <CheckHistory />;
}
