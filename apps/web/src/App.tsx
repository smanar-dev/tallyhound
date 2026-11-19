import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useCallback } from "react";
import { FirmProvider } from "./lib/firm";
import { SignIn } from "./screens/SignIn";
import { Home } from "./screens/Home";
import { Soon } from "./screens/Soon";

function Staff() {
  const signedOut = useCallback(() => { window.location.replace("/signin"); }, []);
  return <FirmProvider onSignedOut={signedOut}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/clients/*" element={<Soon title="Clients" what="Your client list, with each client's checklist, documents and conversation." />} />
    <Route path="/needs-you" element={<Soon title="Needs you" what="Documents Tallyhound is unsure about, client questions and drafts to approve, in one list." />} />
    <Route path="/hound" element={<Soon title="The Hound" what="What Tallyhound has done and why, what is coming up, and the rules it follows." />} />
    <Route path="/add-clients" element={<Soon title="Add clients" what="Import a spreadsheet of clients, or add one at a time." />} />
    <Route path="/messages" element={<Soon title="All messages" what="Every conversation, and messages from senders Tallyhound could not match to a client." />} />
    <Route path="/progress" element={<Soon title="Progress" what="How the season is going: who is complete, how fast documents arrive, how many needed a person." />} />
    <Route path="/settings" element={<Soon title="Settings" what="Your firm's details, people, message wording, storage and how long data is kept." />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></FirmProvider>;
}
export function App() {
  return <BrowserRouter><Routes><Route path="/signin/*" element={<SignIn />} /><Route path="/*" element={<Staff />} /></Routes></BrowserRouter>;
}
