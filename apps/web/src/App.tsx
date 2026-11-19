import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useCallback } from "react";
import { FirmProvider } from "./lib/firm";
import { SignIn } from "./screens/SignIn";
import { Home } from "./screens/Home";
import { Clients } from "./screens/Clients";
import { ClientPage } from "./screens/ClientPage";
import { NeedsYou } from "./screens/NeedsYou";
import { AddClients } from "./screens/AddClients";
import { Messages } from "./screens/Messages";
import { Settings } from "./screens/Settings";
import { Hound } from "./screens/Hound";
import { Progress } from "./screens/Progress";
import { Lock, locked } from "./screens/Lock";
import { useFirm } from "./lib/firm";

function Staff() {
  const signedOut = useCallback(() => { window.location.replace("/signin"); }, []);
  return <FirmProvider onSignedOut={signedOut}><Gate /></FirmProvider>;
}
function Gate() {
  const { T } = useFirm();
  if (locked(T)) return <Routes><Route path="/settings" element={<Settings />} /><Route path="*" element={<Lock />} /></Routes>;
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/clients" element={<Clients />} />
    <Route path="/clients/:id" element={<ClientPage />} />
    <Route path="/needs-you" element={<NeedsYou />} />
    <Route path="/hound" element={<Hound />} />
    <Route path="/add-clients" element={<AddClients />} />
    <Route path="/messages" element={<Messages />} />
    <Route path="/progress" element={<Progress />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
export function App() {
  return <BrowserRouter><Routes><Route path="/signin/*" element={<SignIn />} /><Route path="/*" element={<Staff />} /></Routes></BrowserRouter>;
}
