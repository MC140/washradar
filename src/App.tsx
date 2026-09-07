import {BrowserRouter, Route, Routes} from 'react-router-dom';
import {Toaster} from 'sonner';
import {appConfig} from './config/env';
import {AppShell} from './components/AppShell';
import {WashRadarProvider} from './state/WashRadarContext';
import {AdminPage} from './pages/AdminPage';
import {AlertsPage} from './pages/AlertsPage';
import {ExplorePage} from './pages/ExplorePage';
import {LegalPage} from './pages/LegalPage';
import {NotFoundPage} from './pages/NotFoundPage';
import {ProfilePage} from './pages/ProfilePage';
import {SavedPage} from './pages/SavedPage';
import {WashDetailsPage} from './pages/WashDetailsPage';

function basename() {
  const value = appConfig.basePath.replace(/\/$/, '');
  return value === '' ? '/' : value;
}

export default function App() {
  return <BrowserRouter basename={basename()}><WashRadarProvider><Toaster position="top-center" richColors /><Routes><Route element={<AppShell />}>
    <Route index element={<ExplorePage />} />
    <Route path="wash/:id" element={<WashDetailsPage />} />
    <Route path="saved" element={<SavedPage />} />
    <Route path="alerts" element={<AlertsPage />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="auth/confirm" element={<ProfilePage />} />
    <Route path="privacy" element={<LegalPage page="privacy" />} />
    <Route path="terms" element={<LegalPage page="terms" />} />
    <Route path="sponsored" element={<LegalPage page="sponsored" />} />
    <Route path="support" element={<LegalPage page="support" />} />
    <Route path="admin" element={<AdminPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Route></Routes></WashRadarProvider></BrowserRouter>;
}
