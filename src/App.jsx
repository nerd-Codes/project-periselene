import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Admin from './pages/Admin';
import Judge from './pages/Judge';
import Participant from './pages/Participant';
import SupabaseMissing from './components/SupabaseMissing';
import { supabaseConfigured } from './lib/supabaseClient';

function App() {
  if (!supabaseConfigured) {
    return <SupabaseMissing />;
  }

  return (
    <BrowserRouter>
      <div className="app-container">
        <Routes>
          {/* The "/" path is the first page users see */}
          <Route path="/" element={<Login />} />
          
          {/* These are the protected pages */}
          <Route path="/admin" element={<Admin />} />
          <Route path="/judge" element={<Judge />} />
          <Route path="/participant" element={<Participant />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
