import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useCallback } from "react";
import { FirmProvider } from "./lib/firm";
import { SignIn } from "./screens/SignIn";
import { Home } from "./screens/Home";
import { Soon } from "./screens/Soon";
import { Clients } from "./screens/Clients";
import { ClientPage } from "./screens/ClientPage";
import { NeedsYou } from "./screens/NeedsYou";
import { AddClients } from "./screens/AddClients";
import { Messages } from "./screens/Messages";

function Staff() {
  const signedOut = useCallback(() => { window.location.replace("/signin"); }, []);
  return <FirmProvider onSignedOut={signedOut}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/clients" element={<Clients />} />
    <Route path="/clients/:id" element={<ClientPage />} />
    <Route path="/needs-you" element={<NeedsYou />} />
    <Route path="/hound" element={<Soon title="The Hound" what="What Tallyhound has done and why, what is coming up, and the rules it follows." />} />
    <Route path="/add-clients" element={<AddClients />} />
    <Route path="/messages" element={<Messages />} />
    <Route path="/progress" element={<Soon title="Progress" what="How the season is going: who is complete, how fast documents arrive, how many needed a person." />} />
    <Route path="/settings" element={<Soon title="Settings" what="Your firm's details, people, message wording, storage and how long data is kept." />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></FirmProvider>;
}
export function App() {
  return <BrowserRouter><Routes><Route path="/signin/*" element={<SignIn />} /><Route path="/*" element={<Staff />} /></Routes></BrowserRouter>;
}
