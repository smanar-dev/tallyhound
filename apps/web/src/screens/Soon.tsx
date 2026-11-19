// A screen that is not built yet says so plainly, says what will be there, and points back to what works.
import { Link } from "react-router-dom";
import { Page } from "./Shell";
import { Empty } from "../components/ui";

export function Soon({ title, what }: { title: string; what: string }) {
  return <Page title={title}><div className="card soon"><Empty><b>This screen is being built.</b><br />{what}<br /><Link className="btn" style={{ marginTop: 12 }} to="/">Back to Home</Link></Empty></div></Page>;
}
