import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { initOfflineSync, setCashContext } from './lib/offlineQueue';
import { getOpenRegister } from './lib/shiftService';
import { useIdleLogout } from './lib/useIdleLogout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ShiftOpen from './pages/ShiftOpen';
import NavShell from './components/NavShell';
import type { ShiftRegister } from './lib/types';

// Route-level code splitting: each page is only fetched when the
// person actually navigates to it, instead of all of them landing in
// one ever-growing initial bundle.
const ShiftClose = lazy(() => import('./pages/ShiftClose'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const HqDashboard = lazy(() => import('./pages/HqDashboard'));
const NewBill = lazy(() => import('./pages/NewBill'));
const CollectPayment = lazy(() => import('./pages/CollectPayment'));
const Admissions = lazy(() => import('./pages/Admissions'));
const Expenses = lazy(() => import('./pages/Expenses'));
const ExpenseApprovals = lazy(() => import('./pages/ExpenseApprovals'));
const CashDeposits = lazy(() => import('./pages/CashDeposits'));
const CustomerCredits = lazy(() => import('./pages/CustomerCredits'));
const Returns = lazy(() => import('./pages/Returns'));
const ReturnsOverview = lazy(() => import('./pages/ReturnsOverview'));
const ShiftHistory = lazy(() => import('./pages/ShiftHistory'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const BillsBrowser = lazy(() => import('./pages/BillsBrowser'));
const AddUser = lazy(() => import('./pages/AddUser'));
const OutletManagement = lazy(() => import('./pages/OutletManagement'));
const StaffManagement = lazy(() => import('./pages/StaffManagement'));
const AlertRecipients = lazy(() => import('./pages/AlertRecipients'));
const MyShifts = lazy(() => import('./pages/MyShifts'));
const Disputes = lazy(() => import('./pages/Disputes'));

function PageFallback() {
  return <div className="p-6 text-sm text-slate-400">Loading…</div>;
}

function Shell() {
  const { appUser, loading, error, passwordRecovery, signOut } = useAuth();
  const [register, setRegister] = useState<ShiftRegister | null>(null);
  const [registerLoading, setRegisterLoading] = useState(true);

  useEffect(() => {
    return initOfflineSync();
  }, []);

  // Counter phones are shared between staff — auto-sign-out after
  // inactivity so a walked-away session isn't left open on a
  // financial system. HQ/audit aren't tied to a shared till, so
  // they're left out of this by default.
  useIdleLogout(() => {
    if (appUser && appUser.outlet_id) void signOut();
  });

  // HQ and audit roles aren't tied to a till, so they skip shift
  // gating entirely and land on a cross-outlet overview instead of
  // the register-scoped Dashboard (which they have no register for —
  // previously this fell through to an infinite redirect loop).
  const actorId = appUser?.id;
  const outletId = appUser?.outlet_id;
  const needsShiftGate = !!outletId;
  const isHqOrAudit = appUser?.role === 'hq' || appUser?.role === 'audit';
  const canSeeAuditLog = appUser?.role === 'manager' || isHqOrAudit;

  useEffect(() => {
    setCashContext(null);
    setRegister(null);
    if (!needsShiftGate || !actorId || !outletId) { setRegisterLoading(false); return; }
    let cancelled = false;
    setRegisterLoading(true);
    const cacheKey = `cash-register:${actorId}:${outletId}`;
    getOpenRegister(outletId!)
      .then((r) => { if (!cancelled) { setRegister(r); if (r) localStorage.setItem(cacheKey, JSON.stringify(r)); else localStorage.removeItem(cacheKey); } })
      .catch(() => { if (!cancelled && !navigator.onLine) { const cached = localStorage.getItem(cacheKey); if (cached) { try { setRegister(JSON.parse(cached) as ShiftRegister); } catch { localStorage.removeItem(cacheKey); } } } })
      .finally(() => { if (!cancelled) setRegisterLoading(false); });
    return () => { cancelled = true; };
  }, [needsShiftGate, actorId, outletId]);

  useEffect(() => {
    setCashContext(appUser?.is_active && register?.status === 'open' && register.outlet_id === appUser.outlet_id
      ? { actorId: appUser.id, outletId: register.outlet_id, registerId: register.id } : null);
    return () => setCashContext(null);
  }, [appUser, register]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  // Takes priority over everything else — a person mid password-reset
  // shouldn't see the normal login form or app shell at all.
  if (passwordRecovery) {
    return <ResetPassword />;
  }

  if (!appUser) {
    return (
      <>
        {error && (
          <div className="bg-red-100 text-red-800 text-sm text-center py-2 px-4">{error}</div>
        )}
        <Login />
      </>
    );
  }

  if (needsShiftGate) {
    if (registerLoading) {
      return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
    }
    if (!register) {
      return <ShiftOpen onShiftOpened={setRegister} />;
    }
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<NavShell />}>
            <Route
              index
              element={
                isHqOrAudit ? (
                  <HqDashboard />
                ) : register ? (
                  <Dashboard register={register} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            {!isHqOrAudit && <Route path="new-bill" element={<NewBill />} />}
            {!isHqOrAudit && <Route path="collect-payment" element={<CollectPayment />} />}
            {!isHqOrAudit && <Route path="admissions" element={<Admissions />} />}
            {!isHqOrAudit && <Route path="expenses" element={<Expenses />} />}
            {isHqOrAudit && <Route path="expense-approvals" element={<ExpenseApprovals />} />}
            {appUser.role === 'hq' && <Route path="add-user" element={<AddUser />} />}
            {appUser.role === 'hq' && <Route path="outlets" element={<OutletManagement />} />}
            {appUser.role === 'hq' && <Route path="staff" element={<StaffManagement />} />}
            {appUser.role === 'hq' && (
              <Route path="alert-recipients" element={<AlertRecipients />} />
            )}
            <Route path="my-shifts" element={<MyShifts />} />
            {['hq', 'audit', 'manager'].includes(appUser.role) && (
              <Route path="disputes" element={<Disputes />} />
            )}
            {!isHqOrAudit && <Route path="deposits" element={<CashDeposits />} />}
            {!isHqOrAudit && <Route path="customer-credits" element={<CustomerCredits />} />}
            {!isHqOrAudit && <Route path="returns" element={<Returns />} />}
            {isHqOrAudit && <Route path="returns" element={<ReturnsOverview />} />}
            <Route path="bills" element={<BillsBrowser />} />
            <Route path="shift-history" element={<ShiftHistory />} />
            {canSeeAuditLog && <Route path="audit-log" element={<AuditLog />} />}
            {!isHqOrAudit && (
              <Route
                path="close-shift"
                element={
                  register ? (
                    <ShiftClose
                      register={register}
                      onClosed={() => setRegister(null)}
                      onCancel={() => window.history.back()}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
            )}
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
