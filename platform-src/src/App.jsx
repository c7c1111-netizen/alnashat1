import React, { Suspense } from 'react';
import { AppProvider } from './state/store.jsx';
import { ToastProvider, DialogProvider, Card } from './components/ui.jsx';
import { Shell, NAV, PageHead } from './components/Shell.jsx';
import { useRoute } from './components/router.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Plans from './pages/Plans.jsx';
import PlanDetail from './pages/PlanDetail.jsx';
import Wizard, { NewPlan } from './pages/wizard/Wizard.jsx';
import Timeline from './pages/Timeline.jsx';
import Programs from './pages/Programs.jsx';
import Teachers from './pages/Teachers.jsx';
import Evidence from './pages/Evidence.jsx';
import Reports from './pages/Reports.jsx';
import ExportCenter from './pages/ExportCenter.jsx';
import Settings from './pages/Settings.jsx';

function More() {
  return (
    <div className="page">
      <PageHead title="المزيد" />
      <div className="more-grid">
        {NAV.slice(4).map((n) => <a key={n.href} href={n.href} className="more-tile"><span aria-hidden="true">{n.icon}</span>{n.label}</a>)}
      </div>
    </div>
  );
}

function Router() {
  const route = useRoute();
  const [a, b, c] = route.parts;
  let page;
  if (!a) page = <Dashboard />;
  else if (a === 'plans' && b === 'new') page = <NewPlan />;
  else if (a === 'plans' && b && c === 'edit') page = <Wizard planId={b} key={b} />;
  else if (a === 'plans' && b) page = <PlanDetail planId={b} key={b} />;
  else if (a === 'plans') page = <Plans query={route.query} />;
  else if (a === 'timeline') page = <Timeline />;
  else if (a === 'programs') page = <Programs query={route.query} />;
  else if (a === 'teachers') page = <Teachers />;
  else if (a === 'evidence') page = <Evidence />;
  else if (a === 'reports') page = <Reports query={route.query} />;
  else if (a === 'export') page = <ExportCenter />;
  else if (a === 'settings') page = <Settings />;
  else if (a === 'more') page = <More />;
  else page = <div className="page"><Card><p>الصفحة غير موجودة. <a href="#/">الرئيسية</a></p></Card></div>;
  return <Shell route={route}>{page}</Shell>;
}

export default function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <AppProvider>
          <Suspense fallback={null}><Router /></Suspense>
        </AppProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
