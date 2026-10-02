import Link from "next/link";
import { Guardian } from "../components/Guardian";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="panel empty">
      <Guardian size={88} mood="still" />
      <div>
        <p className="eyebrow">404</p>
        <h1>This page does not exist</h1>
        <p className="lead">Check the address, or return to <Link href="/">home</Link> or <Link href="/policy">policy setup</Link>.</p>
      </div>
    </div>
  );
}
