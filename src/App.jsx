import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Admin from './pages/Admin';
import Judge from './pages/Judge';
import Participant from './pages/Participant';
import Report from './pages/Report';
import SupabaseMissing from './components/SupabaseMissing';
import { supabaseConfigured } from './lib/supabaseClient';

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Routes>
          <Route path="/report" element={<Report />} />
          <Route path="/" element={withSupabase(<Login />)} />
          <Route path="/admin" element={withSupabase(<Admin />)} />
          <Route path="/judge" element={withSupabase(<Judge />)} />
          <Route path="/participant" element={withSupabase(<Participant />)} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function withSupabase(element) {
  return supabaseConfigured ? element : <SupabaseMissing />;
}

export default App;
