import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BookingPage } from "./pages/BookingPage";
import { DraftsPage } from "./pages/DraftsPage";
import { HomePage } from "./pages/HomePage";
import { InfoPage, LegalPage, LoginPage, TrackPage } from "./pages/SecondaryPages";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/personal" element={<InfoPage kind="personal" />} />
        <Route path="/business" element={<InfoPage kind="business" />} />
        <Route path="/partners" element={<InfoPage kind="partners" />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/help" element={<InfoPage kind="help" />} />
        <Route path="/legal/:document" element={<LegalPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
